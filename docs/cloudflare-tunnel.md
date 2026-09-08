# Publish the companion endpoint with Cloudflare Tunnel

This is one supported routing approach; any public HTTPS reverse proxy that preserves the path, POST body and Authorization header can work. The tunnel carries commands and connection setup, not video. You need a domain with DNS managed by Cloudflare and an always-on tunnel host that can reach Scrypted. Use a dedicated hostname, such as `cameras.example.com`.

## 1. Install and create a tunnel

Install `cloudflared` for the tunnel host's OS and CPU using [Cloudflare's downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). A Jetson usually needs an ARM build. Run the following **on the tunnel host**, not necessarily your development computer:

```sh
cloudflared tunnel login
cloudflared tunnel create scrypted-alexa
```

The login opens a browser (or gives a URL to open elsewhere). Select the domain you own. Record the generated tunnel UUID and credentials JSON location. Keep the credentials and account certificate outside this repository.

## 2. Configure the origin and path

Copy [config.yml](../examples/cloudflared/config.yml) to `~/.cloudflared/config.yml`. Replace the UUID, absolute file paths, hostname, Scrypted LAN address and plugin path with your own values. The final 404 rule prevents this tunnel from publishing the management UI. The sample allows only the exact plugin path; method and bearer authentication are checked by the plugin.

The sample verifies the TLS certificate presented by Scrypted. Obtain the origin's certificate/issuing CA securely from your own server, save its PEM file at `caPool`, and set `originServerName` to a DNS name in that certificate's SANs. This may require configuring an origin certificate with a suitable name. Do not copy certificate material from an unverified remote connection and assume it is trusted.

For Scrypted's default self-signed certificate on a trusted LAN, an alternative is replacing the `originRequest` block with:

```yaml
    originRequest:
      noTLSVerify: true
```

This disables certificate verification **only between cloudflared and Scrypted**; it allows impersonation on that network segment. Prefer verified origin TLS, especially when the connector is on a separate host. The public Cloudflare certificate must always validate normally. Never disable TLS verification in Lambda.

Create the DNS route using your own hostname, then validate and start:

```sh
cloudflared tunnel route dns scrypted-alexa cameras.example.com
cloudflared tunnel --config "$HOME/.cloudflared/config.yml" ingress validate
cloudflared tunnel --config "$HOME/.cloudflared/config.yml" ingress rule https://cameras.example.com/endpoint/scrypted-alexa-au/public/
cloudflared tunnel --config "$HOME/.cloudflared/config.yml" ingress rule https://cameras.example.com/
cloudflared tunnel --config "$HOME/.cloudflared/config.yml" run scrypted-alexa
```

The first URL should match the plugin rule; the root URL should match the 404 rule. Use your actual hostname in all commands. If DNS already has a record for that hostname, inspect it before replacing it. Once the foreground tunnel works, install it as an automatically restarting service using Cloudflare's [Linux](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/) or [macOS](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/macos/) instructions. Use absolute paths accessible to the service user. An example Linux installation is:

```sh
sudo cloudflared --config "$HOME/.cloudflared/config.yml" service install
sudo systemctl enable --now cloudflared
```

Do not install another service over an existing cloudflared installation; add the route to that installation instead. Docker users can run the connector separately with persistent config/credential mounts and a restart policy; `localhost` inside that container refers to the connector itself, not Scrypted.

## 3. Configure Cloudflare security

**Standard Bot Fight Mode is incompatible when it challenges Lambda.** It cannot be skipped with a path-specific WAF or Page Rule. Disable it under the zone's Security settings if it blocks this integration. That affects the whole zone. Super Bot Fight Mode supports scoped skip rules; it is a different product. See [Cloudflare's explanation](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/).

Also check country/IP rules, managed WAF rules and browser challenges. Requests originate from AWS Oregon, not your home IP. Inspect Security → Analytics → Events (older UI: Security → Events) using the `cloudflareRay` in Lambda logs. For products that support exceptions, limit any exception to the dedicated hostname, exact plugin path and POST method. Keep the bridge secret authentication enabled.

Do not place an interactive Cloudflare Access login in front of the plugin. Access service tokens would require extra headers in Lambda that this implementation does not send. Other applications on the domain can retain their own Access policies.

## 4. Verify and set the endpoint

```sh
curl -i https://cameras.example.com/endpoint/scrypted-alexa-au/public/
curl -i https://cameras.example.com/
```

Expected: plugin path returns HTTP **401** without its bearer secret; root returns **404**. A login redirect or HTML challenge is incorrect. Do not paste the secret into a shell command or screenshot.

Set `SCRYPTED_ENDPOINT` in the project's `.env.local` to the full public plugin URL, then continue the README deployment steps. After the secret is paired, `npm run diagnose` tests discovery from your computer. **Only `npm run diagnose -- --login` tests the AWS-to-home path**; a successful local request does not rule out Cloudflare blocking AWS.

Reference: [locally managed tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/) and [ingress configuration](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/).
