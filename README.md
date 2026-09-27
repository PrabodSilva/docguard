# 🛡️ DocGuard – Document Expiry Reminder

DocGuard keeps track of when important documents expire (passport, NIC, driving licence,
vehicle revenue licence, insurance, visa…), sends **SMS reminders** before they expire,
and creates **password-locked PDF reports**. It works in any browser and installs on a phone like an app.

## ✨ Features
- Countdown for every document with colored status: 🟢 Valid · 🟡 ≤ 90 days · 🟠 ≤ 30 days · 🔴 Expired
- SMS reminders (90 / 30 / 7 / 1 days before, sent only once, never at night)
- Phone number verification with a 6-digit SMS code
- Password-locked PDF for one document or all documents
- Installable phone app (PWA), dark mode

## 🔐 Privacy & security
- Document numbers, names, issuers, notes and phone numbers are **encrypted (AES-256-GCM)** in the database
- Passwords are **hashed with scrypt**, never stored as plain text
- Numbers are masked (`••••4567`); showing the full number needs the password again
- Auto-lock after 10 minutes, hidden screen in the phone's app switcher
- Login rate limiting, secure cookies, Content-Security-Policy (Helmet)
- SMS messages never include document numbers
- No photos or scans are stored
- Users can delete their account and all data

## 🚀 How to run
Needs **Node.js 22.13 or newer**.

    npm install
    npm start

The browser opens at http://localhost:3000. On the first run a `.env` file with new secret keys is created automatically.
SMS messages are printed in the terminal until an SMS provider (Notify.lk or Twilio) is set in `.env`.

## 🧰 Built with
Node.js · Express · SQLite (built into Node.js) · Helmet · PDFKit · HTML, CSS, JavaScript

## 👤 Author
Prabod Silva — AS2023433