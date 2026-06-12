# Pro Calendar — User Guide

> 🇪🇸 [Versión en español](GUIA-DE-USUARIO.md) · 🇨🇳 [中文版](用户指南.md)

**Pro Calendar** is a desktop calendar for Windows that runs 100% on your computer and syncs with **iCloud** and **Google Calendar**. Events you create on your iPhone or in Google show up on your laptop, and vice versa. It also includes a **to-do** section for tasks.

Your data is yours: it lives in a local database on your machine, not on third-party servers.

---

## 1. Installation

1. Download **`ProCalendar-Setup-1.0.0.exe`** from the project's [`releases/`](../releases/) folder.
2. Run it. You don't need to install Java, MySQL or anything else — everything is bundled.
3. If Windows shows the blue SmartScreen warning ("Windows protected your PC"), click **More info → Run anyway**. It appears because the installer isn't digitally signed yet, not because it's harmful.

There's also **`ProCalendar-Portable-1.0.0.exe`**: the same app with no installation, handy for a USB stick.

> The app stores your data in `C:\Users\<your user>\.procalendar\`. Uninstalling does not delete that folder — your events survive reinstalls.

---

## 2. Getting started

When you open the app you'll see three areas:

- **Left sidebar**: filters by source (All / Google / iCloud), switching between Calendar and Tasks views, and the **Sync now** button.
- **Center**: the calendar, with **Day / Week / Month** tabs at the top. Below it, panels with your priorities, upcoming deadlines and a weekly summary.
- **Right panel**: your pending tasks, with a quick form to add new ones.

### Creating an event

Click **New event** (or click directly on a time slot in the calendar). In the form you can set:

- **Title**, **location** and **notes**.
- **Time slot** (start and end), or the **All day** checkbox for full-day events.
- **Target calendar**: one of your iCloud calendars, a Google one, or **"Local only"** if you don't want it uploaded anywhere.
- Event **color**.

To **edit** an event, click on it. To **delete** it, open it and press Delete: if the event comes from iCloud or Google, the app will warn you that it will be removed there too.

### Tasks (to-do)

In the right panel (or the **Tasks** view in the sidebar) you can create tasks with priority (high / medium / low) and a due date. Mark them done by clicking their circle. You can also **convert an event into a task** from the event itself.

---

## 3. Syncing with iCloud (iPhone/iPad/Mac)

iCloud doesn't allow your regular password in third-party apps; you use an **app-specific password**, generated in a minute:

1. Go to [appleid.apple.com](https://appleid.apple.com) and sign in.
2. Open **Sign-In and Security → App-Specific Passwords** and click **Generate**. Apple gives you something like `abcd-efgh-ijkl-mnop`.
3. In Pro Calendar, open **Settings (⚙) → Accounts**:
   - **Apple ID**: your iCloud email.
   - **App-specific password**: the one you just generated.
   - Check **Enable iCloud sync** and click **Save changes**.
4. Click **Sync now** in the sidebar. The app automatically discovers all your iCloud calendars (Work, Home, etc.) with their colors.

From then on sync is **two-way**: whatever you create or edit on your iPhone appears on your PC and vice versa.

> You can revoke the app-specific password anytime at appleid.apple.com without affecting your account.

---

## 4. Syncing with Google Calendar

Google doesn't support app passwords for Calendar, so the connection is authorized in your browser (Google's official mechanism):

1. In **Settings (⚙) → Accounts**, check **Enable Google sync** and click **Save changes**.
2. Click **Connect Google account**. Your browser opens: pick your account and accept the calendar permissions.
3. You'll see a confirmation page ("✓ Google connected"). Back in the app, Settings will show **✓ Account connected**.

The connection is remembered even after closing or restarting the app. If you ever want to unlink it, revoke access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

## 5. Automatic sync

In **Settings → Sync** you can:

- Enable/disable **automatic background sync**.
- Choose the **interval** in minutes (5 by default).

With it enabled you don't have to do anything: changes from your iPhone or Google appear on their own.

---

## 6. Customization

- **Theme**: light, dark, or automatic following Windows (**Settings → Appearance**).
- **Language**: Spanish, English or Chinese, applied instantly (**Settings → Language**).

---

## 7. FAQ & troubleshooting

**"iCloud error: missing apple-id / app-password"**
You haven't saved the credentials. Check Settings → Accounts and press Save.

**"Incorrect iCloud credentials"**
The app-specific password was mistyped or revoked. Generate a new one at appleid.apple.com.

**"Google error: no OAuth token"**
The account isn't connected yet: Settings → Accounts → Connect Google account.

**The app says the port is busy**
Pro Calendar internally uses ports 8080-8090 and picks the first free one. This warning only appears if all eleven are taken — extremely rare. Close some application and reopen.

**Where is my data? How do I back it up?**
Everything lives in `C:\Users\<your user>\.procalendar\`. Copy that folder and you have a full backup.

**Does the app send my data anywhere?**
Only to the services you enable (iCloud and/or Google), and only your calendar events. With no accounts configured, nothing leaves your machine.

**Do "Local only" events get uploaded anywhere?**
No. They never leave your computer.
