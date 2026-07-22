# Support setup (warpte.com contact form)

## 1. Create the mailbox

Create **`support@warpte.com`** (Google Workspace, Cloudflare Email Routing, ImprovMX, etc.) and forward it to your real inbox if you want.

## 2. Connect the form â†’ email (pick one)

### Option A â€” Web3Forms (fastest, free)

1. Go to https://web3forms.com  
2. Enter **support@warpte.com** and get an **access key**  
3. In Vercel â†’ Project **warp** â†’ Settings â†’ Environment Variables:

| Name | Value |
|------|--------|
| `CONTACT_TO` | `support@warpte.com` |
| `WEB3FORMS_ACCESS_KEY` | *(your key)* |

4. Redeploy.

### Option B â€” Resend

1. https://resend.com â†’ API key  
2. Verify `warpte.com` domain (optional for production from)  
3. Vercel env:

| Name | Value |
|------|--------|
| `CONTACT_TO` | `support@warpte.com` |
| `RESEND_API_KEY` | `re_â€¦` |
| `RESEND_FROM` | `Warp <support@warpte.com>` |

## 3. Marketplace fields

- **Support URL:** https://warpte.com/contact  
- **Also:** https://github.com/warpte-labs/warp/issues  

## 4. GitHub Issues â€œrestrictedâ€

Repo Issues are **enabled**. If visitors still see *â€œIssue creation is restrictedâ€*:

1. Open https://github.com/warpte-labs/warp/settings  
2. **Moderation options** / **Temporary interaction limits** â†’ turn **off**  
3. Ensure youâ€™re **not** limiting to â€œprior contributorsâ€ only  
4. Visitors must be **logged into GitHub** to open issues  

## Repos

| Repo | Purpose |
|------|---------|
| https://github.com/warpte-labs/warp | Extension code |
| https://github.com/warpte-labs/warpte | Landing site (warpte.com) |
