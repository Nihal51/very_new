# Automatic backend deploys

Until this is set up, two things are done by hand after a change: pasting
`firestore.rules` into the Firebase console, and pasting `apps-script/Code.js`
into the Apps Script editor. Easy to forget, and then the live version drifts
from the code.

With the **Deploy backend** workflow (`.github/workflows/deploy-backend.yml`),
a `git push` that changes either one tests it first and then publishes it.
Each half switches on by itself once its secret is added; set up one, both, or
neither.

## Firestore rules → Firebase (10 minutes)

A Google service account that may only publish rules:

1. https://console.cloud.google.com/iam-admin/serviceaccounts?project=drive-buddy-acc4c
   → **Create service account** → name `github-deploy` → Create and continue.
2. Roles: **Firebase Rules Admin**, **Cloud Datastore Index Admin** and
   **Service Usage Consumer** → Done.
3. Open the new account → **Keys** → Add key → Create new key → **JSON**. A
   file downloads. It is a password: never put it in the repo.
4. GitHub → `Nihal51/very_new` → Settings → Secrets and variables → Actions →
   **New repository secret**: name `FIREBASE_SERVICE_ACCOUNT`, value: the whole
   content of that file. Then delete the file from your computer.

From now on, a push that changes `firestore.rules` runs the rules tests on
the emulator and publishes only if they all pass.

## Alerts robot → Apps Script (10 minutes)

1. https://script.google.com/home/usersettings → **Google Apps Script API**:
   On.
2. On your computer (Command Prompt), with the Google account that owns the
   *DriveBuddy Bookings* Sheet:
   ```bash
   npx @google/clasp@2 login
   ```
   A browser opens → Allow. This creates `C:\Users\<you>\.clasprc.json`.
3. GitHub → Settings → Secrets and variables → Actions:
   - **Secret** `CLASPRC_JSON`: the whole content of `.clasprc.json`
   - **Variable** (tab *Variables*) `APPS_SCRIPT_ID`: the Sheet → Extensions →
     Apps Script → ⚙ Project Settings → **Script ID**

From now on, a push that changes `apps-script/` runs the robot's tests and
pushes `Code.js` and `appsscript.json` to the live script. The every-minute
trigger keeps running.

## Notifications: stop strangers sending to customers' phones (5 minutes)

The robot sends booking notifications through Expo. Turn on Expo's *enhanced
security* so only someone with your access token can send them:

1. expo.dev → your DriveBuddy project → **Configuration** → push notifications
   → turn on **Enhanced security for push notifications**.
2. expo.dev → Account settings → **Access tokens** → Create token
   (name it `alerts-robot`).
3. The Sheet → Extensions → Apps Script → ⚙ Project Settings → Script
   properties → add `EXPO_ACCESS_TOKEN` = that token → Save.

Do step 3 right after step 1, or notifications stop until you do.
