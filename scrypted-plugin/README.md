# Personal Alexa Cameras (AU)

This companion plugin connects selected Scrypted cameras to the AWS Lambda backend in the parent project. It does not use the official Scrypted Alexa skill or its account-linking service.

Install the Scrypted WebRTC plugin and enable its extension on your RTSP camera. Paste the generated AWS bridge secret into this plugin's settings, then select the cameras you want to expose. Nothing is exposed by default.

The Local plugin endpoint setting gives the path to expose through an HTTPS reverse proxy or tunnel. Configure that public URL in the parent project's `config.local.json`. The endpoint accepts authenticated POST requests only.

Scrypted handles RTSP conversion and WebRTC connectivity. Allow TURN in the WebRTC plugin when needed for NAT traversal. This bridge supports live view with camera audio, discovery and endpoint health. It does not advertise talkback, motion announcements, snapshots or RTSP URLs to Alexa. Sessions expire after ten minutes if Alexa does not disconnect them.

See the parent README for account linking, AWS deployment and Alexa development testing.
