// Run locally with Node 22+: node scripts/create-admin-config.mjs
// Password is entered without echo, never via command arguments or a file.
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { stdin, stdout, stderr } from 'node:process';
if (!stdin.isTTY || !stdout.isTTY) { stderr.write('Please run this script in an interactive terminal.\n'); process.exit(1); }
async function hidden(prompt) {
  stdout.write(prompt);
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=()=>{stdin.off('data',onData);stdin.setRawMode(false);stdin.pause();stdout.write('\n');};
    const onData=chunk=>{
      for(const char of chunk) {
        if(char==='\u0003'){finish();reject(new Error('Cancelled'));return;}
        if(char==='\r'||char==='\n'){finish();resolve(value);return;}
        if(char==='\u007f'||char==='\b')value=[...value].slice(0,-1).join('');
        else if(char>=' ')value+=char;
      }
    };
    stdin.on('data',onData);
  });
}
try {
  const password=await hidden('Password for admin (16+ characters, input hidden): ');
  const confirmation=await hidden('Confirm password: ');
  if(password!==confirmation)throw new Error('Passwords do not match.');
  if([...password].length<16||Buffer.byteLength(password)>256)throw new Error('Use 16+ characters, up to 256 UTF-8 bytes.');
  const salt=randomBytes(16),sessionKey=randomBytes(32);
  const config={version:1,salt:salt.toString('base64url'),digest:pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64url'),sessionKey:sessionKey.toString('base64url')};
  stdout.write('\nSave your password. Paste the following single line into the Cloudflare Secret ADMIN_AUTH. Do not share it:\n');
  stdout.write(JSON.stringify(config)+'\n');
} catch(e){stderr.write((e instanceof Error?e.message:'Failed')+'\n');process.exitCode=1;}
