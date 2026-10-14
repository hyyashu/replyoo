# Replyooo launch plan

Prepared 14 October 2026 using Nevo’s Brain MCP and Replyooo’s repository.

## Goal and assumptions

Working goal: acquire the first 10 paying customers through a 30-day founder-led launch. This is a proposed target, not a forecast. Assume no substantial existing audience, one founder executing, and little marketing spend. Start Day 1 when the readiness checks below pass; no fixed public launch date is assumed.

The repository establishes product intent and implemented plan limits, but does not establish production reliability, Meta approval status, current customer numbers, or actual live billing prices. Confirm those before making public claims.

## Audience and message

Start with Instagram coaches and digital-product creators who already ask followers to comment a keyword for a guide, workbook, or booking link. Prioritize accounts showing repeated resource requests and an existing paid offer. Audience relevance and actual comment activity matter more than follower count.

Positioning: **Turn Instagram comments into delivered resources and captured leads.**

Suggested launch copy:

> Your next “comment GUIDE” post can do the follow-up for you. Replyooo sends your resource by DM, optionally collects an email, and shares your booking or product link. Start free, with help setting up your first automation.

Demonstrate one workflow: comment GUIDE → receive DM → tap to continue → optionally provide email → receive resource and booking link. Make clear that Replyooo delivers the booking link; it does not book appointments itself.

Lead with Instagram for this campaign. Test Facebook separately once its customer onboarding works. Advertise only capabilities verified in the production product.

Alternative approaches: a broad Product Hunt launch can create visibility but has weaker audience fit; an SEO-led launch can capture existing demand but takes longer to validate. Use direct customer acquisition first, supported by Instagram demonstrations and a small amount of useful search content.

## Readiness gates

Before inviting customers to connect accounts:

- Confirm the required Meta access and live app configuration for the platform being marketed. Have an account outside the development team successfully connect and receive a real automated reply. If public access is unavailable, use demonstrations, interviews, and a waitlist until it is ready.
- Verify signup, connection, template setup, publishing, real delivery, email capture/export, account reconnection, and visible error handling in production.
- Verify a real paid checkout, subscription entitlement update, cancellation, and the displayed price against the actual checkout price.
- Confirm support contact, privacy and deletion flows, monitoring of failed sends, and a way to pause a malfunctioning automation.
- Run the live Meta tests still owed. Only Instagram comment → DM → button tap → DM was verified live (2026-10-08). Still untested on a real account and phone:
  - Follow gate, email question, follow-up reminder and story triggers.
  - Link click tracking: tap a tracked link button and confirm one click is counted, without Instagram's in-app browser or link scanner inflating the count.
  - Run on existing comments: run a 3-day window on a post with a matching comment, confirm the public reply and DM arrive once, and that a second run sends nothing. Confirm Instagram and Facebook return the commenter (`from`) on listed comments.
  - Follow up if no click: leave a link unopened and confirm one follow-up arrives with working tracked links; open the link first and confirm none arrives.
  - Product carousel: a 3-card carousel renders and scrolls on a phone, each card tap counts once, an image-less card works, and Meta accepts the generic template (only tested against the fake Graph API so far).
- Record a real demonstration. Distinguish sample screens and simulated data from actual customer results.

These are tasks to complete, not claims that these checks have passed.

## Offer and upgrade path

Offer founder-assisted setup for the first 20 relevant accounts. Help them configure one workflow for an existing post and resource. Keep the software’s published pricing; use personal help as the launch benefit.

Current code limits:

| Plan | Monthly contacts | Accounts | Live automations |
|---|---:|---:|---:|
| Free | 1,000 | 1 | 3 |
| Pro | 5,000 | 3 | Unlimited |
| Business | 25,000 | 10 | Unlimited |

Free users can receive substantial value without paying. Seek paid candidates who need additional accounts, more than three live automations, or more monthly contacts. Discuss those needs during onboarding. A low-volume creator can be a useful feedback partner without being a likely immediate buyer.

Do not change the free tier based on launch anxiety. Record why activated users do or do not upgrade, then revisit packaging after there is evidence. Do not offer lifetime deals before understanding ongoing service costs and support effort.

## 30-day execution schedule

| Period | Work | Proposed milestone |
|---|---|---|
| Days 1–3 | Pass readiness gates; prepare a 60–90-second demo, setup checklist, tracked signup links, and a prospect list | A real external account completes the workflow |
| Days 4–7 | Identify 50 relevant accounts; contact 5–10 individually per working day; hold five discovery/setup conversations | Five connected accounts and three activated accounts |
| Days 8–14 | Continue relevant outreach; publish three workflow demonstrations; help users run a live post; collect objections | Ten activated accounts and two approved customer examples |
| Days 15–21 | Publish the customer examples; test two creator/consultant collaborations; ask users with clear paid needs to upgrade | First paying customers; identify which source brings activated users |
| Days 22–30 | Concentrate effort on the strongest source; help customers run a second campaign; optionally run the public launch | Work toward ten paying customers and recurring campaign use |

Milestones are planning checkpoints. If onboarding or activation misses them, address that failure before increasing acquisition volume. Missing ten paid customers does not automatically imply failure: distinguish audience mismatch, free-plan sufficiency, product friction, and weak repeat use.

## Channel execution

### 1. Personal outreach

Build a list from public posts where creators already deliver resources manually or use keyword calls to action. Record account, relevant post, resource/offer, outreach date, response, setup status, and paid need. Keep each message specific and truthful.

Suggested message:

> Hi [name] — I saw your [specific post] offering [resource] when people comment [keyword]. I’m building Replyooo to deliver those resources by DM and optionally collect an email. I can help set up one workflow for your next post. Would a short demo be useful?

Send one relevant follow-up after four or five days, then stop if there is no response. Ask about their current process before proposing migration. Keep outreach manual during this experiment.

### 2. Instagram demonstrations

Publish three pieces each week: one full workflow demonstration, one practical setup tip, and one customer example or observed learning. Use a working Replyooo automation on your own demonstration account so interested visitors can experience the product.

Example topics: delivering a free workbook, capturing an email before delivering a resource, and sharing a booking link. Use one clear CTA per post. Publish outcome numbers only with evidence and customer permission; distinguish resource deliveries, emails captured, link clicks, and confirmed bookings.

### 3. Creator and consultant partners

Test two collaborators serving the same audience: creator educators or consultants who help coaches market on Instagram. Offer a walkthrough and a product test. Agree on deliverables and attribution before paying for promotion. Do not promise an affiliate program unless one exists.

Use a separate tracked link for each partner. Compare activated accounts and paid customers, rather than views alone. Cap any initial spend at an amount you can lose; default to organic collaborations until budget is confirmed.

### 4. Search content

Use the existing coaches, lead-magnet, and comparison pages as destinations. Publish two substantive guides: setting up a comment-to-DM resource campaign and collecting email leads through Instagram. Include actual screenshots and troubleshooting from onboarding.

Review competitor statements against current first-party sources before publishing. Measure whether pages produce activated or paid accounts; page count is not a success metric.

## Public launch and Product Hunt

Consider a public launch after at least ten users have completed a live workflow, two customers permit their examples to be shared, support is manageable, and the paid checkout works. Choose a date when you can provide support throughout the day.

Prepare a short demo, screenshots, concise description, founder story, FAQ, pricing link, and tracked CTA. Center the announcement on one strong demonstration on the platform where your actual prospects respond. Invite existing users and interested contacts to try the product and share feedback.

Nevo’s retrieved launch examples emphasize having an audience before launching and concentrating attention around a strong announcement. Those examples largely involve developer products; using Instagram for Replyooo is an audience-based adaptation, not a claim that Nevo validated this exact strategy.

Product Hunt is optional. Its current guidance prohibits asking for upvotes or rewarding them. Request feedback and discussion, and participate in communities where you already have a relevant presence. See [Product Hunt’s promotion guidance](https://www.producthunt.com/launch/sharing-your-launch).

On launch day: test signup and delivery before announcing, publish the demonstration, respond to questions, assist setups, and monitor failures. Over the next two days, follow up with people who requested help and resolve blockers. During the next week, help new users run another campaign.

## Measurement and decisions

Keep a simple acquisition tracker if product analytics are not yet available. Connect campaign source to the account and eventual purchase where possible. Ask users how they found Replyooo when attribution is missing.

Track: qualified conversations → signups → connected accounts → first successful real delivery → repeat campaign activity → paid customers. Exclude founder test accounts and duplicate users.

Activation means an account publishes a workflow and delivers at least one message to a real audience member. Repeat use means a second campaign or continued genuine automation activity in the following week. These definitions are proposals for the launch tracker.

Review every week:

- Few replies after 30 qualified approaches: review prospect relevance and rewrite the message before expanding outreach.
- Signups without connection: investigate onboarding and Meta connection friction.
- Connections without real deliveries: provide setup help and inspect publishing/delivery problems.
- Activation without payment: check whether customers need the paid capabilities; free-plan use alone is not evidence of pricing failure.
- Payment without repeat use: investigate product reliability and whether campaigns recur before scaling acquisition.

Keep cash spend low during the first experiment and record founder time too. After you identify a source producing repeated use and paying customers, devote most acquisition effort to it and retain one small secondary experiment.

## Source basis

Retrieved through `mcp__nevos_brain__search_brain`:

- [Nevo: audience selection, existing demand, and pricing/channel fit](https://x.com/wickedguro/status/2090778859352563921).
- [Digger interview: Product Hunt needs an outside audience](https://www.youtube.com/watch?v=TwYUJNS2foc).
- [Papermark interview: concentrate launch attention around one announcement](https://www.youtube.com/watch?v=z6TpKJSSrbI).
- [Nevo: founder ownership of early marketing strategy](https://gitroom.com/blog/delegation-marketing-vs-engineering).
- [Nevo: attribute purchases and balance immediate channels with SEO](https://x.com/wickedguro/status/2022361200932315279).

Replyooo context: `docs/superpowers/specs/2026-10-05-replyooo-design.md`, `packages/shared/src/plans.ts`, existing coaches and bookings marketing content, and `docs/competitors/reachlee-marketing.md`. Repository documents can describe intended or historical behavior; they do not certify live service readiness.

The niche, timeline, milestones, scripts, and channel order above are tailored recommendations. They are not quotations or guaranteed outcomes from Nevo’s playbooks.
