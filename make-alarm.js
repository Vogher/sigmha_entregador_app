// make-alarm.js — Despertador irritante “PRIIIIN/PRIIIIN”
// Gera:
//   • assets/sounds/alarm.wav        (som de PUSH — canal Android, nome "alarm")
//   • assets/sounds/alarm_bell.mp3   (som do modal — tocado via expo-av)

const ff = require('ffmpeg-static');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SOUNDS_DIR = path.join(ROOT, 'assets', 'sounds');
if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });

function run(args, label = '') {
  return new Promise((resolve, reject) => {
    console.log(`\n[ffmpeg] ${label} => ffmpeg ${args.join(' ')}\n`);
    const p = spawn(ff, args, { stdio: 'inherit' });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exited ' + code))));
  });
}

function buildFilter(finalVolume = 1.80) {
  // Duas senoidais agudas + ruído alto-freq
  // tremolo rápido + gate (apulsator) em 2 Hz => rajadas “PRIIIIN…”
  // equalizer (picos em 2.5 kHz e 3.5 kHz) + eco curto + phaser + bitcrush leve
  return [
    // Nomeia e prepara
    '[0:a]tremolo=f=12:d=0.92,volume=0.9[a0];',
    '[1:a]tremolo=f=12.8:d=0.9,volume=0.7[a1];',
    '[2:a]highpass=f=2500,lowpass=f=7000,volume=0.30[a2];',

    // Mistura as 3 fontes
    '[a0][a1][a2]amix=inputs=3:normalize=0,',

    // Rajadas “PRIIIIN…”
    'apulsator=mode=square:hz=2.0:width=0.50:amount=1,',

    // “Brilho metálico”
    'equalizer=f=2500:t=h:w=200:g=11,',
    'equalizer=f=3500:t=h:w=220:g=9,',

    // Metálico/irritante sem virar barulho sujo
    'aecho=0.07:0.25:40|70:0.30|0.22,',
    'aphaser=type=t:in_gain=0.9:out_gain=0.8:delay=1.4:decay=0.55:speed=0.65,',
    'acrusher=bits=8:mix=0.15,',

    // Limita picos + ganho final
    `alimiter=limit=0.98,volume=${finalVolume.toFixed(2)}[out]`
  ].join('');
}

async function makeAlarmWav(outPath, durSec) {
  const filter = buildFilter(1.80);
  await run(
    [
      '-y', '-hide_banner',

      // Entradas (lavfi)
      '-f','lavfi','-i',`sine=frequency=2400:duration=${durSec}`,
      '-f','lavfi','-i',`sine=frequency=3200:duration=${durSec}`,
      '-f','lavfi','-i',`anoisesrc=d=${durSec}:c=white`,

      // Filtros e mapeamento
      '-filter_complex', filter,
      '-map','[out]',

      // Formatação de saída
      '-ac','1','-ar','44100',

      // Arquivo final
      outPath,
    ],
    `alarm.wav (push)`
  );
}

async function makeAlarmBellMp3(outPath, durSec) {
  const filter = buildFilter(1.85); // um tiquinho mais alto no modal
  await run(
    [
      '-y', '-hide_banner',

      // Entradas
      '-f','lavfi','-i',`sine=frequency=2400:duration=${durSec}`,
      '-f','lavfi','-i',`sine=frequency=3200:duration=${durSec}`,
      '-f','lavfi','-i',`anoisesrc=d=${durSec}:c=white`,

      // Filtros
      '-filter_complex', filter,
      '-map','[out]',

      // Formatação + bitrate mp3
      '-ac','1','-ar','44100','-b:a','192k',

      // Arquivo final
      outPath,
    ],
    `alarm_bell.mp3 (modal)`
  );
}

(async () => {
  try {
    // WAV curto (3s) para PUSH (Android canal usa sound "alarm")
    await makeAlarmWav(path.join(SOUNDS_DIR, 'alarm.wav'), 3);

    // MP3 um pouco mais longo (4s) para o modal (loopado via expo-av)
    await makeAlarmBellMp3(path.join(SOUNDS_DIR, 'alarm_bell.mp3'), 4);

    console.log('\n✅ Sons prontos:');
    console.log('  • assets/sounds/alarm.wav        (push – canal Android, nome "alarm")');
    console.log('  • assets/sounds/alarm_bell.mp3   (modal – expo-av)');
    console.log('\nAjustes finos:');
    console.log('  • Rajadas mais rápidas: apulsator hz=2.0 -> 2.4');
    console.log('  • Mais fino: aumente 2400/3200 para 2600/3600');
    console.log('  • Mais estridente: suba os ganhos dos equalizers (g=11 / g=9).');
  } catch (e) {
    console.error('Erro gerando os sons:', e);
    process.exit(1);
  }
})();
