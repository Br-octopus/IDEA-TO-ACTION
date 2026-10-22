import importlib.util
import ctypes
import base64
import hashlib
import io
import json
import os
import queue
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch


SUPERVISOR_PATH = Path(__file__).resolve().parents[1] / "vendor" / "mediacrawler-bridge" / "windows_job_supervisor.py"


def test_capability(nonce):
    return base64.urlsafe_b64encode(hashlib.sha256(nonce.encode()).digest()).decode("ascii").rstrip("=")


def test_start_frame(module, nonce, mode="action"):
    capability = test_capability(nonce)
    frame = {
        "type": "start", "protocolVersion": 1, "nonce": nonce,
        "capability": capability, "jobName": module.job_name_for_capability(capability),
        "mode": mode,
    }
    if mode == "action":
        frame["request"] = {"requestId": "req_a", "protocolVersion": 1}
    return frame


def test_supervisor_args(mode="action", worker="bridge.py", cwd=".", python="python.exe"):
    return ["--python", python, "--worker", worker, "--mode", mode, "--cwd", cwd]


def load_supervisor():
    spec = importlib.util.spec_from_file_location("windows_job_supervisor", SUPERVISOR_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeProcess:
    def __init__(self):
        self._handle = 123
        self.stdin = io.BytesIO()
        self.stdout = io.BytesIO()
        self.stderr = io.BytesIO()
        self.killed = False
        self.waited = False

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        self.waited = True
        return 1


class SupervisorFailClosedTests(unittest.TestCase):
    def start_message(self, nonce):
        return io.StringIO(json.dumps(test_start_frame(load_supervisor(), nonce)) + "\n")

    def test_job_creation_failure_never_spawns_worker_or_claims_cleanup(self):
        module = load_supervisor()
        nonce = "nonce-a-1234567890"
        frame = test_start_frame(module, nonce)
        job_name = frame["jobName"]
        stderr = io.StringIO()
        spawned = []

        def fail_job(_job_name):
            raise OSError("simulated Job Object creation failure")

        result = module.run_supervisor(
            test_supervisor_args(),
            stdin=self.start_message(nonce), stdout=io.StringIO(), stderr=stderr,
            job_factory=fail_job, popen_factory=lambda *args, **kwargs: spawned.append(args),
        )

        self.assertNotEqual(result, 0)
        self.assertEqual(spawned, [])
        self.assertNotIn("tree-clean", stderr.getvalue())

    def test_job_name_collision_emits_explicit_control_without_starting_worker(self):
        module = load_supervisor()
        nonce = "collision-test-123456"
        start = test_start_frame(module, nonce)
        start["request"]["requestId"] = "req_collision"
        job_name = start["jobName"]
        stderr = io.StringIO()
        spawned = []

        class CollisionError(OSError):
            winerror = 183

        def collide(requested_name):
            self.assertEqual(requested_name, job_name)
            raise CollisionError("already exists")

        result = module.run_supervisor(
            test_supervisor_args(),
            stdin=io.StringIO(json.dumps(start) + "\n"), stdout=io.StringIO(), stderr=stderr,
            job_factory=collide, popen_factory=lambda *args, **kwargs: spawned.append(args),
        )

        self.assertNotEqual(result, 0)
        self.assertEqual(spawned, [])
        controls = [line for line in stderr.getvalue().splitlines() if line.startswith(module.CONTROL_PREFIX)]
        self.assertEqual(len(controls), 1)
        self.assertEqual(json.loads(controls[0][len(module.CONTROL_PREFIX):]), {
            "type": "job-collision", "protocolVersion": 1,
            "nonce": nonce, "jobName": job_name,
        })

    def test_create_job_already_exists_is_classified_without_terminating_existing_job(self):
        module = load_supervisor()
        events = []

        class FakeKernel32:
            def CreateJobObjectW(self, _attributes, job_name):
                events.append(("create", job_name))
                return 42

            def CloseHandle(self, handle):
                events.append(("close", handle))
                return 1

            def TerminateJobObject(self, *_args):
                events.append("terminate")
                raise AssertionError("collision must not terminate the existing Job")

        def initialize(job):
            job._kernel32 = FakeKernel32()

        with patch.object(module.ctypes, "set_last_error", lambda _value: None), \
                patch.object(module.ctypes, "get_last_error", lambda: module.ERROR_ALREADY_EXISTS), \
                patch.object(module.WindowsJob, "_initialize_kernel32", initialize):
            with self.assertRaises(module.JobNameCollisionError):
                module.WindowsJob("Local\\SocialSourceJob-" + "a" * 64)

        self.assertEqual(events[0][0], "create")
        self.assertIn(("close", 42), events)
        self.assertNotIn("terminate", events)

    def test_login_helper_eof_before_start_never_creates_job_or_worker(self):
        module = load_supervisor()
        nonce = "nonce-login-123456789"
        created_jobs = []
        spawned_workers = []

        class UnusedJob:
            def __init__(self, _job_name):
                created_jobs.append(self)

        result = module.run_supervisor(
            test_supervisor_args(mode="login"),
            stdin=io.StringIO(""), stdout=io.StringIO(), stderr=io.StringIO(),
            job_factory=UnusedJob,
            popen_factory=lambda *args, **kwargs: spawned_workers.append(args),
        )

        self.assertEqual(result, 0)
        self.assertEqual(created_jobs, [])
        self.assertEqual(spawned_workers, [])

    def test_cleanup_helper_confirms_missing_job_as_empty(self):
        module = load_supervisor()
        nonce = "cleanup-missing-123456"
        capability = test_capability(nonce)
        job_name = module.job_name_for_capability(capability)
        stdout = io.StringIO()
        result = module.run_job_cleanup(
            job_name, nonce, capability, stdout=stdout, stderr=io.StringIO(),
            job_opener=lambda requested_name: self.assertEqual(requested_name, job_name) or None,
        )

        self.assertEqual(result, 0)
        frame = json.loads(stdout.getvalue())
        self.assertEqual(frame, {
            "type": "job-cleanup", "protocolVersion": 1, "nonce": nonce,
            "jobName": job_name, "jobFound": False, "activeProcesses": 0, "jobClosed": True,
        })

    def test_cleanup_helper_closes_named_job_before_confirmation(self):
        module = load_supervisor()
        nonce = "cleanup-present-123456"
        capability = test_capability(nonce)
        job_name = module.job_name_for_capability(capability)
        events = []

        class Job:
            closed = False

            def terminate_and_wait(self, timeout):
                events.append(("terminate", timeout))

            def active_processes(self):
                events.append("query")
                return 0

            def close(self):
                self.closed = True
                events.append("close")

        job = Job()

        class ConfirmationStream(io.StringIO):
            def write(self, value):
                self.assert_closed = job.closed
                events.append("confirm")
                return super().write(value)

        stdout = ConfirmationStream()
        result = module.run_job_cleanup(
            job_name, nonce, capability, stdout=stdout, stderr=io.StringIO(),
            job_opener=lambda requested_name: job if requested_name == job_name else None,
        )

        self.assertEqual(result, 0)
        self.assertTrue(stdout.assert_closed)
        self.assertEqual(events[-2:], ["close", "confirm"])
        self.assertEqual(json.loads(stdout.getvalue())["jobFound"], True)

    def test_cleanup_helper_failure_does_not_emit_confirmation(self):
        module = load_supervisor()
        nonce = "cleanup-failure-123456"
        capability = test_capability(nonce)
        job_name = module.job_name_for_capability(capability)
        stdout = io.StringIO()

        class FailedJob:
            def terminate_and_wait(self, timeout):
                raise TimeoutError("simulated active Job")

            def active_processes(self):
                return 1

            def close(self):
                pass

        result = module.run_job_cleanup(
            job_name, nonce, capability, stdout=stdout, stderr=io.StringIO(),
            job_opener=lambda _name: FailedJob(),
        )

        self.assertNotEqual(result, 0)
        self.assertEqual(stdout.getvalue(), "")

    def test_job_assignment_failure_kills_gated_worker_without_platform_request(self):
        module = load_supervisor()
        nonce = "nonce-b-1234567890"
        worker = FakeProcess()
        stderr = io.StringIO()

        class FailedAssignmentJob:
            def __init__(self, _job_name):
                pass

            def assign(self, _handle):
                raise OSError("simulated assignment failure")

            def active_processes(self):
                return 0

            def close(self):
                pass

        result = module.run_supervisor(
            test_supervisor_args(),
            stdin=self.start_message(nonce), stdout=io.StringIO(), stderr=stderr,
            job_factory=FailedAssignmentJob, popen_factory=lambda *args, **kwargs: worker,
        )

        self.assertNotEqual(result, 0)
        self.assertTrue(worker.killed)
        self.assertTrue(worker.waited)
        self.assertEqual(worker.stdin.getvalue(), b"")
        self.assertNotIn("tree-clean", stderr.getvalue())


@unittest.skipUnless(os.name == "nt", "Windows Job Object 仅在 Windows 验证")
class WindowsJobSupervisorTests(unittest.TestCase):
    def test_job_termination_waits_until_active_processes_reach_zero(self):
        self.assertTrue(SUPERVISOR_PATH.is_file(), "应提供 Job Object 清理 helper")
        module = load_supervisor()

        job = module.WindowsJob()
        child = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            job.assign(child._handle)
            self.assertGreaterEqual(job.active_processes(), 1)
            job.terminate_and_wait(timeout=5)
            child.wait(timeout=5)
            self.assertEqual(job.active_processes(), 0)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            job.close()

    def test_supervisor_crash_closes_job_and_kills_worker_descendants(self):
        module = load_supervisor()
        with tempfile.TemporaryDirectory(prefix="social-source-job-crash-") as directory:
            worker_path = Path(directory) / "worker.py"
            worker_path.write_text(textwrap.dedent("""
                import json, subprocess, sys, time
                request = json.loads(sys.stdin.readline())
                child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
                print(json.dumps({"childPid": child.pid, "requestId": request["requestId"]}), flush=True)
                time.sleep(60)
            """), encoding="utf-8")
            nonce = "native-crash-test-123456"
            start = test_start_frame(module, nonce)
            cleanup_frame = {
                "type": "cleanup", "protocolVersion": 1, "nonce": nonce,
                "capability": start["capability"], "jobName": start["jobName"],
            }
            helper = subprocess.Popen(
                [sys.executable, "-u", str(SUPERVISOR_PATH), *test_supervisor_args(
                    mode="action", worker=str(worker_path),
                    cwd=str(Path(__file__).resolve().parents[1]), python=sys.executable)],
                cwd=Path(__file__).resolve().parents[1], stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            messages = queue.Queue()
            stderr_chunks = []
            reader = threading.Thread(target=lambda: messages.put(helper.stdout.readline()), daemon=True)
            stderr_reader = threading.Thread(
                target=lambda: [stderr_chunks.append(chunk)
                                for chunk in iter(lambda: helper.stderr.read1(1024), b"")],
                daemon=True,
            )
            try:
                start["request"] = {"requestId": "req_native", "protocolVersion": 1}
                helper.stdin.write((json.dumps(start) + "\n").encode())
                helper.stdin.flush()
                reader.start()
                stderr_reader.start()
                try:
                    line = messages.get(timeout=6)
                except queue.Empty:
                    helper.kill()
                    helper.wait(timeout=5)
                    self.fail(f"helper 未能启动受保护 worker (exit={helper.returncode}): "
                              + b"".join(stderr_chunks).decode("utf-8", "replace"))
                frame = json.loads(line.decode("utf-8"))
                self.assertEqual(frame["requestId"], "req_native")
                child_pid = frame["childPid"]

                helper.kill()
                helper.wait(timeout=5)

                kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel32.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
                kernel32.OpenProcess.restype = ctypes.c_void_p
                kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
                kernel32.WaitForSingleObject.restype = ctypes.c_ulong
                kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
                deadline = time.monotonic() + 5
                alive = True
                while time.monotonic() < deadline:
                    handle = kernel32.OpenProcess(0x00100000, 0, child_pid)
                    if not handle:
                        alive = False
                        break
                    try:
                        alive = kernel32.WaitForSingleObject(handle, 0) != 0
                    finally:
                        kernel32.CloseHandle(handle)
                    if not alive:
                        break
                    time.sleep(0.05)
                self.assertFalse(alive, "helper 崩溃后 Job close 应终止浏览器类后代进程")
                cleanup = subprocess.run(
                    [sys.executable, "-u", str(SUPERVISOR_PATH), "--cleanup"],
                    cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=5,
                    input=json.dumps(cleanup_frame) + "\n",
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                self.assertEqual(cleanup.returncode, 0, cleanup.stderr)
                self.assertEqual(json.loads(cleanup.stdout)["activeProcesses"], 0)
                self.assertTrue(json.loads(cleanup.stdout)["jobClosed"])
            finally:
                if helper.poll() is None:
                    helper.kill()
                    helper.wait(timeout=5)
                for stream in (helper.stdin, helper.stdout, helper.stderr):
                    if stream:
                        stream.close()

    def test_login_ready_is_forwarded_while_worker_remains_running(self):
        with tempfile.TemporaryDirectory(prefix="social-source-login-ready-") as directory:
            worker_path = Path(directory) / "login_worker.py"
            worker_path.write_text(textwrap.dedent("""
                import json, time
                print(json.dumps({"protocolVersion": 1, "type": "login-ready",
                                  "platform": "bilibili", "profileId": "profile_a"}), flush=True)
                time.sleep(60)
            """), encoding="utf-8")
            nonce = "native-login-ready-123456"
            module = load_supervisor()
            start = test_start_frame(module, nonce, mode="login")
            project_root = Path(__file__).resolve().parents[1]
            helper = subprocess.Popen(
                [sys.executable, "-u", str(SUPERVISOR_PATH), *test_supervisor_args(
                    mode="login", worker=str(worker_path), cwd=str(project_root), python=sys.executable)],
                cwd=project_root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            output_lines = queue.Queue()
            error_lines = queue.Queue()
            stdout_reader = threading.Thread(target=lambda: output_lines.put(helper.stdout.readline()), daemon=True)
            stderr_reader = threading.Thread(
                target=lambda: [error_lines.put(line) for line in iter(helper.stderr.readline, b"")],
                daemon=True,
            )
            try:
                helper.stdin.write((json.dumps(start) + "\n").encode())
                helper.stdin.flush()
                stdout_reader.start()
                stderr_reader.start()

                line = output_lines.get(timeout=3)
                ready = json.loads(line.decode("utf-8"))
                self.assertEqual(ready["type"], "login-ready")
                self.assertIsNone(helper.poll(), "login-ready 到达时 browser worker 应仍在运行")

                helper.stdin.write((json.dumps({"type": "stop", "nonce": nonce}) + "\n").encode())
                helper.stdin.flush()
                helper.wait(timeout=5)
                stderr_reader.join(timeout=2)
                controls = []
                while not error_lines.empty():
                    controls.append(error_lines.get_nowait().decode("utf-8", "replace"))
                self.assertTrue(any("SOCIAL_SOURCE_SUPERVISOR:" in line and nonce in line
                                    and '"activeProcesses":0' in line for line in controls))
            finally:
                if helper.poll() is None:
                    helper.kill()
                    helper.wait(timeout=5)
                for stream in (helper.stdin, helper.stdout, helper.stderr):
                    if stream:
                        stream.close()


if __name__ == "__main__":
    unittest.main()
