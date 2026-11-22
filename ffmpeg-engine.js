// ffmpeg-engine.js
const { FFmpeg } = FFmpegWASM;
const { fetchFile, toBlobURL } = FFmpegUtil;

let ffmpeg = null;
let ffmpegLoaded = false;

async function createSameOriginWorkerURL(workerUrl) {
    const response = await fetch(workerUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch worker script: ${response.status}`);
    }
    const scriptText = await response.text();
    const blob = new Blob([scriptText], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
}

async function initFFmpeg(onProgress) {
    if (ffmpegLoaded) return ffmpeg;

    ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
        console.log('[ffmpeg]', message);
    });

    ffmpeg.on('progress', ({ progress }) => {
        if (onProgress) onProgress(Math.min(99, Math.round(progress * 100)));
    });

    const baseCoreURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    const workerSourceURL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js';

    const classWorkerURL = await createSameOriginWorkerURL(workerSourceURL);
    const coreURL = await toBlobURL(`${baseCoreURL}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${baseCoreURL}/ffmpeg-core.wasm`, 'application/wasm');

    await ffmpeg.load({
        classWorkerURL,
        coreURL,
        wasmURL,
    });

    ffmpegLoaded = true;
    return ffmpeg;
}

function getMotionFilter(motionType, framesPerImg, w, h, fps) {
    const filters = {
        kenburns: `scale=${w * 4}:${h * 4}:force_original_aspect_ratio=decrease,` +
            `pad=${w * 4}:${h * 4}:(ow-iw)/2:(oh-ih)/2,` +
            `zoompan=z='min(zoom+0.0008,1.3)':` +
            `x='iw/2-(iw/zoom/2)+sin(on/50)*20':` +
            `y='ih/2-(ih/zoom/2)':d=${framesPerImg}:s=${w}x${h}:fps=${fps}`,

        zoom_in: `scale=${w * 4}:${h * 4}:force_original_aspect_ratio=decrease,` +
            `pad=${w * 4}:${h * 4}:(ow-iw)/2:(oh-ih)/2,` +
            `zoompan=z='min(zoom+0.0015,1.5)':` +
            `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
            `d=${framesPerImg}:s=${w}x${h}:fps=${fps}`,

        zoom_out: `scale=${w * 4}:${h * 4}:force_original_aspect_ratio=decrease,` +
            `pad=${w * 4}:${h * 4}:(ow-iw)/2:(oh-ih)/2,` +
            `zoompan=z='if(lte(zoom,1.0),1.5,max(1.001,zoom-0.0015))':` +
            `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
            `d=${framesPerImg}:s=${w}x${h}:fps=${fps}`,

        pan_right: `scale=${w * 3}:${h}:force_original_aspect_ratio=decrease,` +
            `pad=${w * 3}:${h}:(ow-iw)/2:(oh-ih)/2,` +
            `crop=${w}:${h}:x='(iw-${w})*(on/${framesPerImg})':y=0`,

        pan_left: `scale=${w * 3}:${h}:force_original_aspect_ratio=decrease,` +
            `pad=${w * 3}:${h}:(ow-iw)/2:(oh-ih)/2,` +
            `crop=${w}:${h}:x='(iw-${w})*(1-on/${framesPerImg})':y=0`,
    };
    return filters[motionType] || filters.kenburns;
}

async function buildVideoInBrowser({
    imageFiles,   // array of File objects
    audioFile,    // File or null
    motionType = 'kenburns',
    transitionType = 'fade',
    duration = 3,
    resolution = '1280x720',
    onProgress = () => { },
}) {
    const ff = await initFFmpeg(onProgress);

    const [w, h] = resolution.split('x').map(Number);
    const fps = 30;
    const framesPerImg = Math.floor(duration * fps);
    const transitionDuration = 0.5;

    // كتابة الصور في نظام ملفات FFmpeg الافتراضي
    const imageNames = [];
    for (let i = 0; i < imageFiles.length; i++) {
        const name = `img_${i}.jpg`;
        await ff.writeFile(name, await fetchFile(imageFiles[i]));
        imageNames.push(name);
    }

    // كتابة الصوت إن وجد
    let audioName = null;
    if (audioFile) {
        audioName = 'audio' + (audioFile.name.match(/\.[^.]+$/)?.[0] || '.mp3');
        await ff.writeFile(audioName, await fetchFile(audioFile));
    }

    // بناء أمر FFmpeg
    const args = ['-y'];

    for (const name of imageNames) {
        args.push('-loop', '1', '-t', String(duration), '-i', name);
    }
    if (audioName) {
        args.push('-i', audioName);
    }

    // بناء الفلاتر
    const filters = [];
    for (let i = 0; i < imageNames.length; i++) {
        const motion = getMotionFilter(motionType, framesPerImg, w, h, fps);
        filters.push(`[${i}:v]${motion}[v${i}]`);
    }

    let finalVideo;
    if (imageNames.length > 1 && transitionType !== 'none') {
        let current = '[v0]';
        const xfadeMap = { fade: 'fade', slideleft: 'slideleft' };
        const xfadeType = xfadeMap[transitionType] || 'fade';

        for (let i = 1; i < imageNames.length; i++) {
            const offset = (duration * i - transitionDuration).toFixed(2);
            filters.push(
                `${current}[v${i}]xfade=transition=${xfadeType}:` +
                `duration=${transitionDuration}:offset=${offset}[x${i}]`
            );
            current = `[x${i}]`;
        }
        finalVideo = current;
    } else if (imageNames.length > 1) {
        filters.push(
            imageNames.map((_, i) => `[v${i}]`).join('') +
            `concat=n=${imageNames.length}:v=1:a=0[out]`
        );
        finalVideo = '[out]';
    } else {
        finalVideo = '[v0]';
    }

    args.push('-filter_complex', filters.join(';'));
    args.push('-map', finalVideo);

    if (audioName) {
        args.push('-map', `${imageNames.length}:a`, '-c:a', 'aac', '-b:a', '128k', '-shortest');
    }

    args.push(
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        'output.mp4'
    );

    await ff.exec(args);

    const data = await ff.readFile('output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });

    // تنظيف الملفات
    for (const name of imageNames) await ff.deleteFile(name);
    if (audioName) await ff.deleteFile(audioName);
    await ff.deleteFile('output.mp4');

    return blob;
}
