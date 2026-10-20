HMZ AI — FULL-STACK CHAT APP
============================

This is a real full-stack web-app starter, not a screenshot/mockup. It includes:
- Responsive chat interface for mobile and desktop
- User registration and sign-in
- Password hashing using Node's built-in scrypt
- Private chat history per account, stored on the server
- AI responses through an OpenAI-compatible Chat Completions API
- Chat list, new chat, and persistent messages

REQUIREMENTS
- Node.js 18 or newer
- An API key from an AI provider compatible with the OpenAI Chat Completions API
- A hosting service for a public link (not included automatically)

RUN LOCALLY
1. Install Node.js 18+ on a computer/server.
2. Open this folder in a terminal.
3. Set environment variables:
   AI_API_KEY=your_secret_key
   AI_MODEL=gpt-4o-mini
   AI_BASE_URL=https://api.openai.com/v1
4. Start:
   npm start
5. Visit http://localhost:3000

On macOS/Linux:
  AI_API_KEY="your_secret_key" npm start

On Windows PowerShell:
  $env:AI_API_KEY="your_secret_key"
  npm start

IMPORTANT
- Never put your API key into public/index.html or any browser-side code.
- The AI provider may charge for usage; check its pricing and free-tier availability.
- This app is not yet deployed to a public URL. To share it with friends, deploy the server to a Node.js hosting provider and configure the environment variables there.
- The built-in JSON database is suitable for a small prototype, not a high-traffic production service. Use a managed database for production.
- Before public launch, add rate limiting, email verification/password reset, stronger session protections, HTTPS-only secure cookies behind HTTPS, CSRF protections as appropriate, monitoring, and a privacy policy. Don't collect data you don't need.
- Data is stored in data/db.json on the server. Back it up carefully and protect access to the server.
- User passwords are hashed; they are not stored in plain text.
