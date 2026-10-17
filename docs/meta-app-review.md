# Meta App Review: Replyinger (4521343034787359)

Status on 17 October 2026: no submission yet. Meta reports `can_submit: true`, a privacy policy present and business verification passing.

## Before you submit (blockers)

1. **Production must run on Replyinger.** The live `.env` still has `META_APP_ID=3164775173722180`, which is the old ReplyBash app. Reviewers test the live site, so the Connect button must open Replyinger's login. Set `META_APP_ID` / `META_APP_SECRET` to Replyinger's values. Set `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` to Replyinger's Instagram app (App Dashboard → Instagram → API setup with Instagram login). Then redeploy.
2. **Webhooks on Replyinger.** Set the callback URL to `https://replyoo-hooks.sitebackend.com/webhooks/meta` (Dokploy gives the worker its own host; see `docs/deploy.md`) and use `META_WEBHOOK_VERIFY_TOKEN` as the verify token. Subscribe:
   - Instagram: `comments`, `messages`, `messaging_postbacks`
   - Page: `messages`, `messaging_postbacks`, `feed`
3. **Fill in Settings → Basic:**
   - App icon: 1024×1024.
   - Description and short description: use the text below.
   - Support URL: a page or `mailto:` that someone answers.
   - User data deletion: choose "Data deletion callback URL" → `https://replyoo.sitebackend.com/api/meta/data-deletion`.
   - Deauthorize callback (Facebook Login settings): `https://replyoo.sitebackend.com/api/meta/deauthorize`.
   - Verify the contact email (`itshyyashu@gmail.com`).
4. **A reviewer account on Replyooo.** Create a normal workspace on the live site with email and password. Reviewers can't receive sign-in codes, so use the email-and-password login. Put the credentials in the review notes.
5. **Live test first.** Run comment → DM → button tap → link once on production with Replyinger before recording.

## Recommendation: Instagram first

The launch is Instagram-only, and Facebook hasn't been tested live. Submit the three Instagram permissions now and the Page permissions in a second submission. A smaller request is reviewed faster, and a Facebook rejection can't hold up Instagram.

## Description

Short: *Turn Instagram comments into DMs that deliver your links and capture leads.*

Long: *Replyooo lets creators and small businesses reply automatically when someone comments a keyword on their Instagram posts or messages them. The business builds a short flow: a public reply to the comment, a private DM with a button, an optional email question, and the link or resource they promised. Replyooo only messages people who commented or messaged the business first, inside Meta's 24-hour window, and the business can pause any automation at any time.*

## Permissions and what to write for each

Each permission needs a usage description and a screencast. In every recording, show the Meta login dialog granting the permission, then the feature that uses it. Record in English, at 1080p if possible.

### Instagram (submit now)

**instagram_business_basic**
> Used to identify the connected Instagram professional account (id, username, name, profile picture, follower count) so the business can see which account it connected, and to list its posts and stories so it can choose which ones an automation listens to.

Screencast: Connect Instagram → login dialog → account appears in Replyooo → create an automation → post picker lists the account's posts.

**instagram_business_manage_comments**
> When someone comments a keyword the business chose, Replyooo posts the business's public reply under that comment and sends the commenter a private reply. It also reads existing comments on a post the business selects, so the business can run an automation on comments made before it was published.

Screencast: comment the keyword from a second Instagram account → the public reply appears under the comment → the DM arrives.

**instagram_business_manage_messages**
> Sends the DMs the business wrote to people who commented or messaged it, receives their replies and button taps to continue the conversation, reads their name, username and whether they follow the business to personalize messages and run an optional follow gate, and sets the account's ice breakers. Messages are only sent in reply to a user's action, inside the 24-hour window.

Screencast: on a phone, the DM with a button arrives → tap it → the next message with the link arrives. Show the email question and the conversation in Replyooo's contacts.

### Facebook Pages (second submission)

| Permission | Use |
|---|---|
| `pages_show_list` | List the Pages the user manages so they can pick one to connect. |
| `pages_manage_metadata` | Subscribe the Page to webhooks and set its Messenger ice breakers. |
| `pages_read_engagement` | Read Page posts and comments, to let the business pick posts and to run on existing comments. |
| `pages_manage_engagement` | Post the business's public reply under a keyword comment. |
| `pages_messaging` | Send Messenger replies to people who commented or messaged the Page. |

Also request the **Business Asset User Profile Access** feature: the Facebook adapter reads `name` and `profile_pic` for `{{first_name}}` and for the contacts list.

## Reviewer notes (paste into "Notes for reviewer")

> 1. Go to https://replyoo.sitebackend.com/login and sign in with: email `<REVIEWER_EMAIL>`, password `<REVIEWER_PASSWORD>`.
> 2. Click **Connect Instagram** and log in with an Instagram professional account.
> 3. Open **Automations → New**, choose the "Comment to DM" template, keep the keyword `LINK`, and click **Publish**.
> 4. From a different Instagram account, comment `LINK` on any post of the connected account. A public reply appears under the comment and a DM with a button arrives. Tap the button to receive the link.
> 5. Received conversations and captured emails appear under **Contacts**.
>
> Replyooo only sends messages in response to a user's comment or message, within the 24-hour messaging window.

## After approval

Re-check status with the Meta MCP (`devtools_app_review` → `status`, app `4521343034787359`), then remove the "only people with a role on the app can connect" caveat from the launch checklist.
