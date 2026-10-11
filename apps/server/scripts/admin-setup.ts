// Sets up the admin dashboard login: a password and an authenticator app (6-digit codes).
//   pnpm admin:setup
// Writes ADMIN_PASSWORD_HASH and ADMIN_TOTP_SECRET to apps/server/.env.local (ignored by git).
// On a real server, copy those two lines into its environment variables instead.
// Run it again any time to change the password or move to a new phone (old codes stop working).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import QRCode from 'qrcode';
import { hashPassword, newTotpSecret, otpauthUrl, verifyTotp } from '../src/admin/crypto';

const ENV_FILE = '.env.local';
const MIN_LENGTH = 12;

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Echo stars instead of the password.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.startsWith(question)) process.stdout.write(question);
        else if (s.includes('\n') || s.includes('\r')) process.stdout.write('\n');
        else process.stdout.write('*'.repeat(s.length));
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Sets KEY='value' lines in .env.local, keeping everything else. */
function writeEnv(values: Record<string, string>) {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split(/\r?\n/) : [];
  const kept = lines.filter((l) => !Object.keys(values).some((k) => l.startsWith(`${k}=`)));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  const added = Object.entries(values).map(([k, v]) => `${k}='${v}'`);
  writeFileSync(ENV_FILE, [...kept, ...(kept.length ? [''] : ['# Secrets for this machine only. Never commit this file.']), ...added, ''].join('\n'), { mode: 0o600 });
}

async function main() {
  console.log('\nWanted: True Colors: admin dashboard login\n');
  // Scripted use (CI, tests): ADMIN_SETUP_PASSWORD and ADMIN_SETUP_TOTP_SECRET skip the questions.
  let password = process.env.ADMIN_SETUP_PASSWORD ?? '';
  if (!password) {
    for (;;) {
      password = await ask(`Choose an admin password (at least ${MIN_LENGTH} characters): `, true);
      if (password.length < MIN_LENGTH) {
        console.log(`Too short. Use at least ${MIN_LENGTH} characters (a few random words works well).`);
        continue;
      }
      if ((await ask('Type it again: ', true)) !== password) {
        console.log("They don't match. Try again.");
        continue;
      }
      break;
    }
  } else if (password.length < MIN_LENGTH) {
    throw new Error(`ADMIN_SETUP_PASSWORD must be at least ${MIN_LENGTH} characters`);
  }

  const secret = process.env.ADMIN_SETUP_TOTP_SECRET ?? newTotpSecret();
  if (!process.env.ADMIN_SETUP_TOTP_SECRET) {
    const url = otpauthUrl(secret);
    console.log('\nScan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy):\n');
    console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
    console.log(`Can't scan? Add it by hand. Key: ${secret.match(/.{1,4}/g)!.join(' ')} (time-based, 6 digits)\n`);
    for (;;) {
      const code = (await ask('Type the 6-digit code the app shows now: ')).replace(/\s/g, '');
      if (verifyTotp(secret, code, Date.now()) !== null) break;
      console.log("That code doesn't match. Check the phone's clock is set automatically, and try the next code.");
    }
  }

  writeEnv({ ADMIN_PASSWORD_HASH: await hashPassword(password), ADMIN_TOTP_SECRET: secret });
  console.log(`\nSaved to apps/server/${ENV_FILE} (git ignores it).`);
  console.log('Restart the server (pnpm dev or pnpm playtest), then open /admin on your site.');
  console.log('Keep the authenticator on your phone: without it you can only get back in by running this again on the server.\n');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
