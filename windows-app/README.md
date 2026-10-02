# 🖥️ TimeBloker Windows Desktop Application

This directory contains the **Electron Desktop App** wrapper for TimeBloker, bringing native Windows operating system capabilities to the application.

---

## ✨ Native Desktop Features

- **System Tray Integration**: Access TimeBloker from the Windows taskbar tray area. Minimize to tray, quick-reopen, and context menu.
- **Native OS Notifications**: Receives native Windows 10/11 Toast Notifications when Pomodoros finish or habit reminders trigger.
- **Always-on-Top Toggle**: Pin TimeBloker above other windows while doing deep focus work or timing tasks.
- **Offline / Local Caching**: Works seamlessly with local storage and syncs automatically with Supabase when online.
- **Portable & Installer Builds**: Builds clean `.exe` installers (`NSIS`) and single-file `portable.exe` binaries for Windows.

---

## 🚀 How to Run

### Development Mode
Make sure your Vite web app server is running, then start the Windows desktop shell:

```bash
# In project root:
npm run dev

# In another terminal / window:
npm run desktop:dev
```

---

## 📦 How to Build `.exe` Executable

To compile a standalone Windows installer (`.exe`) and portable binary:

```bash
# From root directory:
npm run desktop:build
```

The compiled binaries will be generated inside:
`windows-app/dist-win/`
