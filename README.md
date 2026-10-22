[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

BlindVault is a mathematically guaranteed blind grading and hiring portal where candidate identities remain cryptographically sealed by TideCloak Emergent Authority until the entire judging quorum locks final scores.

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

We propose **BlindVault**, a true-blind evaluation workspace for university grading, scholarship selection, and technical hiring. Unlike conventional portals where "blind review" merely hides a UI column while backend admins still hold full access, BlindVault makes premature identity unmasking or bias mathematically impossible.

### 2. Trust constraint insight

Today, blind review relies on trusting database administrators, committee chairs, or cloud operators not to join the `submissions` and `identities` tables before scores are finalized. Removing this trust bottleneck lets institutions run provably fair assessments where neither insiders nor compromised servers can peek at candidate identities early.

### 3. Value & impact

Students, grant applicants, and job candidates gain verifiable protection against unconscious bias, nepotism, and leaks. For example, a scholarship committee can grade portfolios knowing not even the IT admin or chair can see which student submitted which project until all three judges cryptographically lock their evaluations.

### 4. Why TideCloak matters

Standard RBAC only checks `if (role === 'admin')` on a server that still holds the decryption keys. BlindVault integrates **TideCloak** (`@tidecloak/nextjs`) for authentication and tag-based E2EE (`doEncrypt` / `doDecrypt`). Decryption authority only emerges when reviewer identity, TideCloak tag roles, and our 3-of-3 judging quorum policy align—with zero server master key.

### 5. Prototype & storytelling

Our prototype demonstrates client-side identity encryption, multi-judge blind scoring, and a live **"Rogue Admin / DB Override"** simulator. Judges should test clicking **"Simulate Rogue Admin / DB Override Attempt"** at 2/3 quorum (which fails with ciphertext) versus locking the 3rd judge's score to trigger Emergent Authority decryption via `doDecrypt()`.

## Setup

### Option 1: Run Full Stack with Docker Compose (Recommended)

1. Unzip the archive and enter the project folder:
   ```bash
   unzip blindvault-tidecloak-nextjs-v2.zip -d blindvault
   cd blindvault
   ```
2. Start both the **TideCloak server** (`tideorg/tidecloak-dev:latest`) and the **BlindVault Next.js app**:
   ```bash
   docker compose up --build
   ```
3. Open the services in your browser:
   - **BlindVault App**: `http://localhost:3000`
   - **TideCloak Admin Console**: `http://localhost:8080` (`admin` / `password`)

### Option 2: Run Next.js Locally (`npm run dev`)

1. Install dependencies:
   ```bash
   npm install --legacy-peer-deps
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:3000`. BlindVault automatically links with `@tidecloak/nextjs` (`doEncrypt` / `doDecrypt`) when authenticated and includes a built-in **Hybrid Cryptographic Sandbox** so judges can test the 2/3 vs. 3/3 Quorum Emergent Authority flow immediately with zero setup friction.
