# Spend Tracker: install on your phone with Google Drive backup

Your data lives on the phone and is copied to a hidden app-data file in YOUR Google Drive
(only this app can see it). It works offline; syncing happens when you are online.

## 1. Create the Google sign-in key (about 10 minutes, one time)
1. Go to console.cloud.google.com and create a new project (e.g. "Spend Tracker").
2. APIs & Services > Library > search "Google Drive API" > Enable.
3. Google Auth Platform (older name: OAuth consent screen): set app name and your email,
   choose "External", keep it in "Testing", and add your own Gmail under "Test users".
   Under Data Access add the scope  .../auth/drive.appdata  (the only scope this app uses).
4. Clients (older name: Credentials) > Create client > "Web application".
   Under "Authorized JavaScript origins" add the web address where you will host the app
   (step 2 below), like  https://your-name.netlify.app  (no slash at the end, no path).
5. Copy the Client ID.
Menu names shift a little between Google Console versions; follow the same idea.

## 2. Host the folder on HTTPS
Easiest: sign in at netlify.com, then Sites > drag this whole folder in. (Anonymous drops
are removed after about an hour, so make an account.) GitHub Pages also works.
If you host first, you get the web address you need for step 1.4.

Open index.html in a text editor and replace  PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com
with your Client ID. Upload the folder again.

## 3. Install on the phone
Option A (easiest): open your web address in Chrome on Android > menu (three dots) >
"Install app". It appears in your app drawer and opens like a normal app.
Option B (a real .apk file): go to pwabuilder.com, enter your web address, choose
"Package for stores" > Android, and download the package. Install the .apk on your phone
(allow "install unknown apps"). If the app shows an address bar, PWABuilder's instructions
explain how to add its assetlinks.json file to your host.

## 4. Use it
Home > Google Drive backup > Sign in. After that, changes sync automatically about 2 seconds
after you save. On a second phone, sign in with the same Google account and tap Sync now.
Purchases and products from both devices are merged; deletions carry across.
If sync says the session expired, tap Reconnect (Google sign-ins last about an hour).

## New in this version
- **Scan a bill**: Home > Scan a bill. Upload a photo or PDF of a receipt; it reads the
  text in your browser (needs internet the first time, to fetch the reading library) and
  guesses the total and date. You always see the photo and an editable form before saving,
  so fix anything it got wrong.
- **Reports**: choose Day / Week / Month / Year / Custom and compare to the previous
  period of the same length.
- **Bills & subscriptions**: Home > Bills & subscriptions. Add rent, electricity, mobile,
  subscriptions etc. with how often they repeat. "Enable reminders" asks for notification
  permission; reminders are checked when you open the app (there is no background push
  without a server, so true silent background alerts aren't possible from a plain web app).
