# Passkeys and security keys

A passkey or a security key lets you sign in without typing a 6-digit code. It cannot be phished: your browser only offers it to this application's own address, so a look-alike site gets nothing it can use. This page explains how to add one, how to sign in with it, and what to do if you lose it. Your password and the authenticator app are described in [Getting started](01-getting-started.md) and [Administration](09-administration.md).

## Passkey or security key?

| | What it is | How you use it |
|---|---|---|
| **Passkey** | A key kept by your computer, your phone or your password manager. Some are copied to your other devices ("synced") | Confirm with your fingerprint, face or device PIN |
| **Security key** | A small hardware key that plugs into a USB port or is held against the phone (NFC) | Touch the key, and type its PIN if it has one |

Either one can stand in for the 6-digit code after your password. A passkey (or a security key with a PIN) can also sign you in **on its own**, without your password.

A passkey counts as your second factor. If your organisation requires a second factor, adding a passkey or security key is enough: you do not also need the authenticator app.

## Before you start

- Use the address your administrator gave you, by its name (for example `https://grc.example.org`). Passkeys do not work when the application is opened at a numeric address such as `http://127.0.0.1:8080`; on the local prototype, open `http://localhost:8080` instead. The card tells you when this is the problem.
- You need a current browser. If yours cannot use passkeys, the card says "This browser cannot use passkeys or security keys."

## Add a passkey or security key

1. Select your name at the top right, then **Account security**.
2. In the **Passkeys and security keys** card, select **Add a passkey or security key** (or **Add another key** if you already have one).
3. You may be asked to **Confirm your password**: adding a key changes how you sign in, so the application checks it is really you. Type your password and select **Confirm and continue**.
4. Type a **Name** that tells your keys apart, such as "Work laptop" or "Blue security key", and select **Continue**.
5. Your browser asks where to keep the passkey (this device, your phone or a password manager), or asks you to touch your security key. Follow its steps.
6. The message "*name* added. You can use it the next time you sign in." is shown and the key appears in the list.

Each key in the list shows its name, its kind (**Passkey on this device**, **Synced passkey**, **Security key** or **Passkey**), when it was added and when it was last used (and from which address). An account can have up to ten keys.

**Add two.** Register a second key, or keep the authenticator app as well, so that losing one does not lock you out. Recovery codes come with the authenticator app; there are none for passkeys.

The same card is also on its own page at **/account/passkeys**.

### When adding a key fails

| Message | What it means |
|---|---|
| "Nothing happened: the request was cancelled or timed out." | You closed the browser's window, or did not use the key in time. Select **Continue** again |
| "That key is already registered to your account." | The key is already in your list |
| "You already have a key with that name." | Choose another name |
| "This address cannot use passkeys…" | Open the application by its host name, not a numeric address |
| "The request came from … which is not this application's address." | The page was opened at an address the application does not recognise; ask your administrator |

## Rename or remove a key

- **Rename**: select **Rename** beside the key, change the **Name** and select **Save**.
- **Remove**: select **Remove**, then **Remove key**. The key stops working at once. You may be asked to confirm your password first. If it was your only second factor and your organisation requires one, you will be asked to set one up again.

Remove a key straight away if the device or security key is lost or stolen.

## Sign in with a passkey

**With a passkey alone.** On the sign-in page select **Sign in with a passkey** (or open **/sign-in/passkey**). Your browser lists the passkeys it holds for this site; choose yours and confirm with your fingerprint, face or PIN. A passkey used this way must check who you are (fingerprint, face or PIN); a security key that only needs a touch cannot sign you in on its own.

**After your password.** Type your username and password and select **Sign in**. If you have a key:

- With no authenticator app, your browser asks for your key straight away.
- With the authenticator app as well, you are asked for the 6-digit code; select **Use a passkey or security key instead** to use your key.

If the key is refused you see "Sign-in with the key failed. Try again, or sign in with your password." A key whose use counter has gone backwards is refused, because that can mean it was copied; tell your administrator.

## For administrators

- On a person's page (**Administration**, **Users**, then the person) the **Passkeys and security keys** card lists their keys. Select **Remove** and then **Remove key** to remove one, for example when a security key is reported lost. You will be asked to confirm your own password. The person cannot be given a key by an administrator; they add their own.
- Every addition, rename, removal, use and refusal is recorded in the audit log (`passkey.register`, `passkey.rename`, `passkey.revoke`, `passkey.used`, `passkey.refused`, and `passkey.sign_count_regression` for a possible copied key). Signing in with a passkey alone is recorded as "Signed in via passkey".
- Two settings control passkeys: `auth.passkey_sign_in` (default on) allows signing in with a passkey alone, and `auth.passkey_user_verification` (`preferred` by default, or `required`) decides whether every use must check a PIN or biometric, which rules out touch-only security keys.
- The break-glass account can use a hardware security key as its second factor in the same way as anyone else.

## The second factor on a new installation

When the application is first set up, the setup wizard asks how to treat the second factor:

- **Require it for administrators and security leads (recommended)** — chosen unless you change it. Straight after creating the first administrator you are taken to **Account security** to set up an authenticator app or add a passkey; nothing else is available until you do. Administrators and security leads added later do the same at their first sign-in.
- **Only remind people for now** — people see a reminder but can work without a second factor.

Either can be changed later under **Administration**, **Settings** (second-factor enforcement). Installations set up before this choice existed keep their current setting.
