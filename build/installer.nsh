; 向前一步只补充安装提示，安装器主体和卸载入口仍由 electron-builder 管理。
; 用户数据位于 Electron userData 目录，卸载时按 package.json 的默认保留策略处理。

!macro customInstall
  DetailPrint "向前一步安装完成。"
!macroend

!macro customUnInstall
  DetailPrint "正在卸载向前一步，用户数据按默认策略保留。"
!macroend
