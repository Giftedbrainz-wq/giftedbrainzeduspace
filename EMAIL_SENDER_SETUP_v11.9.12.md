# Gifted Brainz EduSpace — Email Sender Setup

The password-reset flow is implemented in the Student Portal. Supabase Auth sends the recovery email.

Set the Supabase Auth email sender/display name to exactly:

**Gifted Brainz EduSpace**

Do not use “Super B”.

In Supabase Dashboard, open **Authentication → Email → SMTP Settings** and set the SMTP sender/display name to `Gifted Brainz EduSpace`. Supabase exposes this setting as `smtp_sender_name`. If custom SMTP is enabled, the SMTP provider may also require the sender name to be set there.

The application itself does not expose or transmit SMTP credentials to the browser.


## Required Supabase Auth setting
Set the SMTP sender/display name to exactly **Gifted Brainz EduSpace** (with a space). Do not use “Super B”. This setting is controlled by the Supabase Auth SMTP/email configuration and is not a browser-side value.
