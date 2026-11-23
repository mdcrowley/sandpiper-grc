# User provisioning and log forwarding

This page is for administrators. It covers two connections to the systems around the application:

- **User provisioning**: your identity provider (the directory where people's accounts live) creates accounts here, keeps their names and email addresses up to date, gives roles through groups, and switches accounts off the moment someone leaves. It uses SCIM 2.0, the standard most identity providers speak.
- **Log forwarding**: every event in the audit log is sent, as it happens, to your security monitoring system, as syslog or as JSON over HTTPS.

Both are off until you set them up, and both appear in the **Administration** group: **User provisioning** and **Log forwarding**. They are not parts you switch on and off under **Features**; each has its own switch. Only administrators (`admin.administer`) see them, and the steps that hand out access or change where events go ask you to confirm your password.

## User provisioning

Open **Administration > User provisioning**. The page has four cards: **Provisioning** (the switch and the address), **Provisioning tokens**, **Groups and roles**, and **Recent activity**.

### Setting it up

1. Under **Provisioning tokens**, select **Make token**. Give it a **Name** (for example the identity provider that will use it) and, if you know them, the **Allowed addresses** your identity provider calls from (one address or range a line, such as `203.0.113.7` or `198.51.100.0/24`; empty allows any address). Select **Make token** and confirm your password.
2. The token is **shown once**. Select **Copy token** and paste it into your identity provider's provisioning settings straight away. Only a fingerprint of it is kept here, so it cannot be shown again; if it is lost, make a new one and revoke the old one.
3. Copy the **SCIM endpoint** address from the **Provisioning** card into the identity provider too. It is the application's address followed by `/api/scim/v2`. The identity provider sends the token as `Authorization: Bearer`.
4. Optionally choose a **Sign-in provider for new accounts** (see [Signing in](#signing-in)).
5. Switch on **Provisioning switched on** and confirm your password.

Until provisioning is switched on, every request is refused, even with a valid token. Make one token for each identity provider, so each can be revoked on its own.

### What provisioning may do

- **Create accounts.** A new account has the name, email address and user name the identity provider sends, **no password here** and **no roles**. It is shown on **Users** like any other account. If the user name is not one the application accepts (for example an email address), a local user name is made from it (`sam.sample@example.org` becomes `sam.sample`); the identity provider keeps using its own.
- **Change accounts**: the name, email address and user name. When the email address changes, the old address is sent a message saying so.
- **Deactivate accounts.** When someone is switched off or removed at the identity provider, their account here is **disabled at once**: their sessions end, their unused set-up and reset links stop working, and their **API tokens** and **AI assistant connections** are revoked. Nothing is deleted: the account, its roles and its history stay, and the audit log records what was ended.
- **Enable accounts again**, but only an account provisioning disabled itself. Enabling restores the account only: its tokens and assistant connections stay revoked. An account an administrator disabled stays disabled whatever the identity provider sends.
- **Send groups and their members.** A group gives **no role** until you map it (below).

Provisioning never:

- deactivates the last active administrator (the request is refused);
- sees or changes the **break-glass account** (see [Administration](09-administration.md#the-break-glass-account));
- gives a role that can administer (any role holding `admin.administer`, `admin.*` or `*`);
- changes the email address of, deactivates, or enables again an account that can administer (any role holding an `admin.` permission or `*`), even if that role is switched off. Do that by hand under **Users**. The refusal is recorded in the audit log;
- removes a role an administrator gave by hand.

### Groups and roles

Groups appear under **Groups and roles** when your identity provider sends them, with how many members each has. To give the members of a group a role:

1. Select **Map roles** beside the group.
2. Choose the **Roles**. Roles that can administer are not offered: give those by hand under **Users**.
3. Select **Save mapping** and confirm your password.

Every member's roles are brought in step at once, and again whenever someone joins or leaves the group. A role given through a group is taken away when the person leaves every group that gives it, or when the mapping changes. A role an administrator gave by hand under **Users** is never taken away by provisioning, even if a group also gives it. If a mapped role is later changed to include administration, provisioning takes it back from the people it gave it to rather than keep handing it out.

### Signing in

Accounts made by provisioning have no password here, so people sign in through single sign-on (see [Sign-in providers](09-administration.md#sign-in-providers-single-sign-on)). A sign-in provider matches an account by its verified email address and normally asks for the account's password before linking the two, which a provisioned account does not have. Choose the provider under **Sign-in provider for new accounts**: every account provisioning creates, or enables again, may then link that provider by its email address at its first sign-in, for 30 days. Accounts that can administer never get a link permit from provisioning. Without one, an administrator allows each link under **Users** as described in [Administration](09-administration.md#passkeys-and-single-sign-on-on-a-persons-page).

### Tokens

The **Provisioning tokens** list shows each token's name, the start of the token, where it may be used from, when it was last used and from where, and whether it is active. From the **…** menu:

- **Change addresses**: the addresses or ranges it may be used from (asks for your password).
- **Revoke**: the token stops working at once. Accounts it created stay as they are.

A request with a missing, wrong or revoked token, a token used from an address it does not allow, or any token while provisioning is switched off, gets the same answer, and each is recorded in the audit log. After 20 refused requests from one address in five minutes, that address is refused for a while, even with a good token. Each token may make 600 requests a minute.

### What is recorded

Every change provisioning makes is in the audit log, with **Provisioning (token name)** as the person who made it, the address it came from and the request id. **Recent activity** lists the last 50 provisioning changes and refused requests; the [audit log](09-administration.md#the-audit-log) has the rest.

## Log forwarding

Open **Administration > Log forwarding**. A forwarder sends every audit event, in order, to one collector (a security information and event management system, or a log server in front of one).

**Nothing is sent until outbound connections are switched on.** Under **Settings > Outbound connections**, switch on **Allow outbound connections** and add the collector's host and port to **Allowed hosts** (for example `logs.example.org:6514`). A collector on your internal network must be listed by its address as well, as for webhooks. New forwarders start **switched off**.

### Adding a forwarder

1. Select **Add forwarder** and give it a **Name**.
2. Choose **How to send**:
   - **Syslog over TLS** (recommended): give the collector's **Host** and **Port** (6514 if left empty). Each event is a syslog message (RFC 5424) carrying the event as JSON; choose **JSON, one event a line** under **Format** if your collector prefers plain JSON.
   - **Syslog over TCP (unencrypted)**: the same, port 514 by default, with no encryption. The audit log names people and records, so use it only inside a network you trust.
   - **JSON over HTTPS**: give the collector's https **Address**. Each batch is posted as JSON lines (`application/x-ndjson`). An optional **Secret** is sent as a bearer token and used to sign each batch (the `X-GRC-Signature` header, made as for webhooks).
3. If the collector's certificate comes from your own certificate authority, paste that authority's certificate under **Certificate authority**. Certificates are always checked; a collector whose certificate cannot be checked gets nothing.
4. Optionally list **Only these actions**, one a line: an action such as `signin.failure`, or a family such as `user.` or `webhook.*`. Empty sends every event.
5. Choose **Start with**: **Events from now on**, or **The whole audit log, from the beginning**.
6. Switch it on now or later, select **Add forwarder** and confirm your password.

The address and the secret are kept encrypted; the page shows the host only.

### How events are sent

- About once a minute, each forwarder that is on sends the events it has not sent yet, in batches of up to 500, oldest first. An event is sent once it is a few seconds old.
- When the collector cannot be reached, nothing is lost: the forwarder keeps its place, waits (one minute, doubling up to an hour), then sends from where it stopped. The list shows the last error, how many events are waiting and when it will try again.
- Values that look like secrets (passwords, tokens, keys, hashes) are removed from what is sent, and webhook addresses are shown by host and fingerprint only, as in the audit log here.
- **Forwarded events cannot be recalled.** The audit log names people and records. Once sent, events are kept by the collector under its own retention rules: they are not removed from it when anything here reaches the end of its retention period, or is anonymized or removed. Agree how long the collector keeps them with whoever runs it.

### Managing forwarders

The **On** switch pauses or restarts a forwarder (switching it on asks for your password); while it is off, events wait for it. From the **…** menu:

- **Edit**: change any setting. Changing where it sends (how, host, port, address, secret or certificate authority) asks for your password. Leave the address empty to keep the one stored.
- **Delivery log**: each batch sent (with the range of audit event numbers), each failure with its reason, and each test.
- **Send a test event**: sends one test event now, through the same checks, and says what happened. It does not change what is sent next.
- **Remove**: stops the forwarder and erases its address and secret. Events already sent stay in the collector.

### The delivery log

The **Delivery log** card sets how long the delivery log is kept (30 days to begin with, 1 to 3650). Older rows are removed once a day. This is the log of what was sent, not the events themselves.

## Not available yet

- Provisioning in bulk (SCIM bulk requests), sorting, and attributes the application does not keep (titles, phone numbers, addresses) are not supported; those attributes are ignored.
- A forwarder sends to one collector. To send to two, add two forwarders.
