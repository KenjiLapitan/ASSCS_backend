ENV CONTAINS

MODE=DEV

DB_USER=
DB_HOST=
DB_NAME=
DB_PASSWORD=
DB_PORT=

ACCESS_TOKEN_SECRET=

ALLOW_ORIGINS=

GEMINI_API_KEY=
GEMINI_MODEL=

To generate access token
`node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

1. Install mkcert
winget install FiloSottile.mkcert

2. Install the local CA
mkcert -install

3. Get your PC's local IP
ipconfig

4. Generate a certificate
In your React project, create a folder: cert

Then run:
mkcert localhost 127.0.0.1 [SERVER IP]
