/** Reads a line from the terminal; `hidden` masks the input (for passwords). */
export function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    if (!stdin.isTTY) {
      reject(new Error('pas de terminal interactif ; utiliser les variables MNEMON_EMAIL / MNEMON_PASSWORD.'));
      return;
    }
    stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stderr.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0 && !hidden) stderr.write('\b \b');
          value = value.slice(0, -1);
        } else {
          value += ch;
          if (!hidden) stderr.write(ch);
        }
      }
    };
    stdin.on('data', onData);
  });
}

export function fail(message) {
  console.error(`Erreur : ${message}`);
  process.exit(1);
}
