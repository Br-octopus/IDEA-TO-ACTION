"""Windows Job Object supervisor for the isolated MediaCrawler bridge worker."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
from ctypes import wintypes
from typing import Callable, Optional, Sequence, TextIO


PROTOCOL_VERSION = 1
CONTROL_PREFIX = "SOCIAL_SOURCE_SUPERVISOR:"
NONCE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
CAPABILITY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
MAX_WORKER_STDERR_LINE_BYTES = 8192
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION = 1
JOB_OBJECT_QUERY = 0x0004
JOB_OBJECT_TERMINATE = 0x0008
ERROR_FILE_NOT_FOUND = 2
ERROR_ALREADY_EXISTS = 183
GATE_CODE = (
    "import json,runpy,sys; "
    "worker,mode=sys.argv[1:3]; "
    "gate=json.loads(sys.stdin.readline()); "
    "(gate.get('type')=='supervisor-gate' and gate.get('protocolVersion')==1) or sys.exit(71); "
    "sys.argv=[worker]+(['--open-login'] if mode=='login' else []); "
    "runpy.run_path(worker,run_name='__main__')"
)


class _IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in (
        "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
        "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
    )]


class _BasicLimitInformation(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_longlong),
        ("PerJobUserTimeLimit", ctypes.c_longlong),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class _ExtendedLimitInformation(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", _BasicLimitInformation),
        ("IoInfo", _IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


class _BasicAccountingInformation(ctypes.Structure):
    _fields_ = [
        ("TotalUserTime", ctypes.c_longlong),
        ("TotalKernelTime", ctypes.c_longlong),
        ("ThisPeriodTotalUserTime", ctypes.c_longlong),
        ("ThisPeriodTotalKernelTime", ctypes.c_longlong),
        ("TotalPageFaultCount", wintypes.DWORD),
        ("TotalProcesses", wintypes.DWORD),
        ("ActiveProcesses", wintypes.DWORD),
        ("TotalTerminatedProcesses", wintypes.DWORD),
    ]


class WindowsJob:
    """关闭句柄时由 Windows 杀死整个 Job；绑定失败时调用方必须拒绝运行。"""

    def _initialize_kernel32(self):
        if os.name != "nt":
            raise OSError("Windows Job Object is unavailable")
        self._kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self._kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self._kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        self._kernel32.SetInformationJobObject.argtypes = [
            wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
        ]
        self._kernel32.SetInformationJobObject.restype = wintypes.BOOL
        self._kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self._kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
        self._kernel32.QueryInformationJobObject.argtypes = [
            wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
            ctypes.POINTER(wintypes.DWORD),
        ]
        self._kernel32.QueryInformationJobObject.restype = wintypes.BOOL
        self._kernel32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self._kernel32.TerminateJobObject.restype = wintypes.BOOL
        self._kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        self._kernel32.CloseHandle.restype = wintypes.BOOL
        self._kernel32.OpenJobObjectW.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR]
        self._kernel32.OpenJobObjectW.restype = wintypes.HANDLE

    def __init__(self, job_name: Optional[str] = None):
        self._initialize_kernel32()
        ctypes.set_last_error(0)
        self._handle = self._kernel32.CreateJobObjectW(None, job_name)
        create_error = ctypes.get_last_error()
        if not self._handle:
            raise ctypes.WinError(create_error)
        if job_name is not None and create_error == ERROR_ALREADY_EXISTS:
            try:
                self.close()
            except BaseException:
                # 进程退出时 Windows 会关闭句柄；仍须保留碰撞分类，禁止外部恢复器打开它。
                pass
            raise JobNameCollisionError()
        limits = _ExtendedLimitInformation()
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self._kernel32.SetInformationJobObject(
            self._handle, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            ctypes.byref(limits), ctypes.sizeof(limits),
        ):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    @classmethod
    def open_existing(cls, job_name: str):
        instance = cls.__new__(cls)
        instance._initialize_kernel32()
        handle = instance._kernel32.OpenJobObjectW(
            JOB_OBJECT_QUERY | JOB_OBJECT_TERMINATE, False, job_name,
        )
        if not handle:
            error = ctypes.get_last_error()
            if error == ERROR_FILE_NOT_FOUND:
                return None
            raise ctypes.WinError(error)
        instance._handle = handle
        return instance

    def assign(self, process_handle) -> None:
        if not self._kernel32.AssignProcessToJobObject(self._handle, process_handle):
            raise ctypes.WinError(ctypes.get_last_error())

    def active_processes(self) -> int:
        info = _BasicAccountingInformation()
        if not self._kernel32.QueryInformationJobObject(
            self._handle, JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION,
            ctypes.byref(info), ctypes.sizeof(info), None,
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        return int(info.ActiveProcesses)

    def terminate_and_wait(self, timeout: float = 10.0) -> None:
        if self.active_processes() and not self._kernel32.TerminateJobObject(self._handle, 1):
            raise ctypes.WinError(ctypes.get_last_error())
        deadline = time.monotonic() + timeout
        while self.active_processes() != 0:
            if time.monotonic() >= deadline:
                raise TimeoutError("Job Object cleanup timed out")
            time.sleep(0.025)

    def close(self) -> None:
        handle = getattr(self, "_handle", None)
        if handle and not self._kernel32.CloseHandle(handle):
            raise ctypes.WinError(ctypes.get_last_error())
        self._handle = None


class JobNameCollisionError(OSError):
    """命名 Job 已存在；该句柄不代表本次启动拥有 Job。"""

    def __init__(self):
        super().__init__(ERROR_ALREADY_EXISTS, "named Job Object already exists")
        self.winerror = ERROR_ALREADY_EXISTS


def job_name_for_capability(capability: str) -> str:
    if not CAPABILITY_PATTERN.fullmatch(capability):
        raise ValueError("invalid capability")
    digest = hashlib.sha256(capability.encode("ascii")).hexdigest()
    return f"Local\\SocialSourceJob-{digest}"


def _write_control(stderr: TextIO, nonce: str) -> None:
    frame = {
        "type": "tree-clean", "protocolVersion": PROTOCOL_VERSION,
        "nonce": nonce, "activeProcesses": 0,
    }
    stderr.write(CONTROL_PREFIX + json.dumps(frame, separators=(",", ":")) + "\n")
    stderr.flush()


def _write_job_collision(stderr: TextIO, nonce: str, job_name: str) -> None:
    frame = {
        "type": "job-collision", "protocolVersion": PROTOCOL_VERSION,
        "nonce": nonce, "jobName": job_name,
    }
    stderr.write(CONTROL_PREFIX + json.dumps(frame, separators=(",", ":")) + "\n")
    stderr.flush()


def run_job_cleanup(
    job_name: str,
    nonce: str,
    capability: str,
    *,
    stdout: Optional[TextIO] = None,
    stderr: Optional[TextIO] = None,
    job_opener: Callable[[str], Optional[WindowsJob]] = WindowsJob.open_existing,
    timeout: float = 10.0,
) -> int:
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    try:
        if (not NONCE_PATTERN.fullmatch(nonce)
                or job_name != job_name_for_capability(capability)):
            raise ValueError("invalid cleanup target")
        job = job_opener(job_name)
        job_found = job is not None
        if job is not None:
            try:
                job.terminate_and_wait(timeout=timeout)
                active_processes = job.active_processes()
                if active_processes != 0:
                    raise TimeoutError("Job Object still has active processes")
            finally:
                job.close()
        else:
            active_processes = 0
        frame = {
            "type": "job-cleanup", "protocolVersion": PROTOCOL_VERSION,
            "nonce": nonce, "jobName": job_name, "jobFound": job_found,
            "activeProcesses": active_processes, "jobClosed": True,
        }
        stdout.write(json.dumps(frame, separators=(",", ":")) + "\n")
        stdout.flush()
        return 0
    except BaseException:
        stderr.write("SUPERVISOR_ERROR:JOB_CLEANUP_FAILED\n")
        stderr.flush()
        return 1


def _read_start(stdin: TextIO, mode: str) -> tuple[bool, Optional[dict]]:
    line = stdin.readline()
    if not line:
        return False, None
    try:
        message = json.loads(line)
    except (TypeError, ValueError):
        raise ValueError("invalid start frame") from None
    expected = {"type", "protocolVersion", "nonce", "capability", "jobName", "mode"}
    if mode == "action":
        expected.add("request")
    if (not isinstance(message, dict) or set(message) != expected
            or message.get("type") != "start" or message.get("protocolVersion") != PROTOCOL_VERSION
            or not isinstance(message.get("nonce"), str) or not NONCE_PATTERN.fullmatch(message["nonce"])
            or not isinstance(message.get("capability"), str)
            or not CAPABILITY_PATTERN.fullmatch(message["capability"])
            or message.get("jobName") != job_name_for_capability(message["capability"])
            or message.get("mode") != mode):
        raise ValueError("invalid start frame")
    if mode == "action":
        request = message.get("request")
        if (not isinstance(request, dict) or request.get("protocolVersion") != PROTOCOL_VERSION
                or not isinstance(request.get("requestId"), str)):
            raise ValueError("invalid start request")
    return True, message


def _read_cleanup(stdin: TextIO) -> Optional[dict]:
    line = stdin.readline()
    if not line:
        return None
    try:
        message = json.loads(line)
    except (TypeError, ValueError):
        raise ValueError("invalid cleanup frame") from None
    if (not isinstance(message, dict)
            or set(message) != {"type", "protocolVersion", "nonce", "capability", "jobName"}
            or message.get("type") != "cleanup"
            or message.get("protocolVersion") != PROTOCOL_VERSION
            or not isinstance(message.get("nonce"), str)
            or not NONCE_PATTERN.fullmatch(message["nonce"])
            or not isinstance(message.get("capability"), str)
            or not CAPABILITY_PATTERN.fullmatch(message["capability"])
            or message.get("jobName") != job_name_for_capability(message["capability"])):
        raise ValueError("invalid cleanup frame")
    return message


def _relay_stdout(source, destination) -> None:
    try:
        while True:
            chunk = source.read1(16 * 1024)
            if not chunk:
                return
            destination.buffer.write(chunk)
            destination.buffer.flush()
    except (BrokenPipeError, OSError):
        return


def _relay_stderr(source, destination) -> None:
    current = bytearray()
    discarding_long_line = False

    def emit_line(raw: bytes) -> None:
        destination.write("WORKER: " + raw.decode("utf-8", errors="replace"))
        destination.flush()

    try:
        while True:
            chunk = source.read1(1024)
            if not chunk:
                break
            while chunk:
                newline = chunk.find(b"\n")
                piece = chunk if newline < 0 else chunk[:newline + 1]
                chunk = b"" if newline < 0 else chunk[newline + 1:]
                if discarding_long_line:
                    if piece.endswith(b"\n"):
                        emit_line(b"[long worker diagnostic omitted]\n")
                        discarding_long_line = False
                    continue
                if len(current) + len(piece) > MAX_WORKER_STDERR_LINE_BYTES:
                    current.clear()
                    discarding_long_line = True
                    if piece.endswith(b"\n"):
                        emit_line(b"[long worker diagnostic omitted]\n")
                        discarding_long_line = False
                    continue
                current.extend(piece)
                if piece.endswith(b"\n"):
                    emit_line(bytes(current))
                    current.clear()
        if current:
            emit_line(bytes(current))
        elif discarding_long_line:
            emit_line(b"[long worker diagnostic omitted]\n")
    except (BrokenPipeError, OSError):
        return


def run_supervisor(
    argv: Optional[Sequence[str]] = None,
    *,
    stdin=None,
    stdout=None,
    stderr=None,
    job_factory: Callable[[str], WindowsJob] = WindowsJob,
    popen_factory: Callable = subprocess.Popen,
    job_opener: Callable[[str], Optional[WindowsJob]] = WindowsJob.open_existing,
) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--python")
    parser.add_argument("--worker")
    parser.add_argument("--mode", choices=("action", "login"))
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--cwd")
    try:
        args = parser.parse_args(argv)
    except SystemExit:
        return 2
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    if args.cleanup:
        if any((args.python, args.worker, args.mode, args.cwd)):
            stderr.write("SUPERVISOR_ERROR:INVALID_CLEANUP_ARGUMENTS\n")
            return 2
        try:
            cleanup = _read_cleanup(stdin)
        except ValueError:
            stderr.write("SUPERVISOR_ERROR:INVALID_CLEANUP_FRAME\n")
            return 2
        if cleanup is None:
            stderr.write("SUPERVISOR_ERROR:MISSING_CLEANUP_FRAME\n")
            return 2
        return run_job_cleanup(
            cleanup["jobName"], cleanup["nonce"], cleanup["capability"],
            stdout=stdout, stderr=stderr, job_opener=job_opener,
        )
    if not args.python or not args.worker or not args.mode or not args.cwd:
        stderr.write("SUPERVISOR_ERROR:INVALID_START_ARGUMENTS\n")
        return 2

    job = None
    worker = None
    assigned = False
    stop_requested = threading.Event()
    try:
        try:
            start_received, start_frame = _read_start(stdin, args.mode)
        except ValueError:
            stderr.write("SUPERVISOR_ERROR:INVALID_START_FRAME\n")
            return 2
        if not start_received:
            return 0
        nonce = start_frame["nonce"]
        job_name = start_frame["jobName"]
        request = start_frame.get("request")
        try:
            job = job_factory(job_name)
        except BaseException as error:
            collision = isinstance(error, JobNameCollisionError) or (
                getattr(error, "winerror", None) == ERROR_ALREADY_EXISTS
                or getattr(error, "errno", None) == ERROR_ALREADY_EXISTS
            )
            if collision:
                _write_job_collision(stderr, nonce, job_name)
                return 73
            raise
        command = [
            args.python, "-u", "-c", GATE_CODE,
            args.worker, args.mode,
        ]
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        worker = popen_factory(
            command, cwd=args.cwd, shell=False, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=creation_flags,
        )
        try:
            job.assign(worker._handle)
            assigned = True
        except BaseException:
            # 子进程仍停在固定 gate；绑定失败时绝不发送 gate/request。
            try:
                worker.kill()
            finally:
                worker.wait(timeout=5)
            raise

        worker.stdin.write((json.dumps({"type": "supervisor-gate", "protocolVersion": PROTOCOL_VERSION}) + "\n").encode())
        if request is not None:
            worker.stdin.write((json.dumps(request, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
        worker.stdin.flush()

        stdout_thread = threading.Thread(target=_relay_stdout, args=(worker.stdout, stdout), daemon=True)
        stderr_thread = threading.Thread(target=_relay_stderr, args=(worker.stderr, stderr), daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        def read_controls():
            for line in iter(stdin.readline, ""):
                try:
                    frame = json.loads(line)
                except (TypeError, ValueError):
                    stop_requested.set()
                    return
                if (not isinstance(frame, dict) or set(frame) != {"type", "nonce"}
                        or frame.get("type") != "stop" or frame.get("nonce") != nonce):
                    stop_requested.set()
                    return
                stop_requested.set()
                return
            stop_requested.set()

        control_thread = threading.Thread(target=read_controls, daemon=True)
        control_thread.start()
        while worker.poll() is None and not stop_requested.wait(0.025):
            pass

        # 即使 bridge 正常退出，也清理由它启动但未能回收的浏览器后代。
        job.terminate_and_wait(timeout=10.0)
        worker.wait(timeout=5)
        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)
        if stdout_thread.is_alive() or stderr_thread.is_alive() or job.active_processes() != 0:
            raise TimeoutError("worker streams or Job Object did not close")
        _write_control(stderr, nonce)
        return 130 if stop_requested.is_set() else (worker.returncode or 0)
    except BaseException:
        stderr.write("SUPERVISOR_ERROR:CLEANUP_OR_START_FAILED\n")
        stderr.flush()
        if worker is not None and not assigned:
            try:
                worker.kill()
                worker.wait(timeout=5)
            except BaseException:
                pass
        if assigned and job is not None:
            try:
                job.terminate_and_wait(timeout=10.0)
                if job.active_processes() == 0:
                    _write_control(stderr, nonce)
            except BaseException:
                pass
        return 1
    finally:
        if job is not None:
            # 进程异常终止也会关闭 Job 句柄并触发 KILL_ON_JOB_CLOSE。
            try:
                job.close()
            except BaseException:
                pass


def main() -> int:
    return run_supervisor()


if __name__ == "__main__":
    raise SystemExit(main())
