// app.js
const state = {
    images: [],   // { id, file, url }
    audio: null,  // File
};

// ============ رفع الصور ============
const dropZone = document.getElementById('dropZone');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const clearImagesBtn = document.getElementById('clearImages');

dropZone.addEventListener('click', () => imageInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    await handleImageFiles(Array.from(e.dataTransfer.files));
});

imageInput.addEventListener('change', async (e) => {
    await handleImageFiles(Array.from(e.target.files));
    imageInput.value = '';
});

async function handleImageFiles(files) {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (state.images.length + imageFiles.length > 10) {
        alert('الحد الأقصى 10 صور');
        return;
    }

    for (const file of imageFiles) {
        const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        // حفظ في IndexedDB
        await Storage.saveImage(id, file, { name: file.name, size: file.size });
        state.images.push({ id, file, url: URL.createObjectURL(file) });
    }
    renderImagePreviews();
}

function renderImagePreviews() {
    imagePreview.innerHTML = '';
    state.images.forEach((img, idx) => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.innerHTML = `
            <img src="${img.url}" alt="preview">
            <button class="remove" data-idx="${idx}">×</button>
        `;
        div.querySelector('.remove').addEventListener('click', async () => {
            URL.revokeObjectURL(img.url);
            await Storage.deleteImage(img.id);
            state.images.splice(idx, 1);
            renderImagePreviews();
        });
        imagePreview.appendChild(div);
    });

    clearImagesBtn.classList.toggle('hidden', state.images.length === 0);
}

clearImagesBtn.addEventListener('click', async () => {
    for (const img of state.images) {
        URL.revokeObjectURL(img.url);
        await Storage.deleteImage(img.id);
    }
    state.images = [];
    renderImagePreviews();
});

// استرجاع الصور من IndexedDB عند التحميل
(async () => {
    const saved = await Storage.getAllImages();
    for (const item of saved) {
        state.images.push({
            id: item.id,
            file: item.blob,
            url: URL.createObjectURL(item.blob),
        });
    }
    renderImagePreviews();
})();

// ============ رفع الصوت ============
const audioInput = document.getElementById('audioInput');
const audioPreview = document.getElementById('audioPreview');

audioInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.audio = file;
    audioPreview.src = URL.createObjectURL(file);
    audioPreview.classList.remove('hidden');
});

// ============ إنشاء الفيديو ============
const generateBtn = document.getElementById('generateBtn');
const statusEl = document.getElementById('status');
const resultCard = document.getElementById('resultCard');
const resultVideo = document.getElementById('resultVideo');
const downloadLink = document.getElementById('downloadLink');

generateBtn.addEventListener('click', async () => {
    if (state.images.length === 0) {
        alert('ارفع صورة واحدة على الأقل');
        return;
    }

    generateBtn.disabled = true;
    resultCard.style.display = 'none';
    statusEl.classList.remove('hidden', 'success', 'error');
    statusEl.innerHTML = `
        <div>⚙️ تحميل محرك الفيديو (أول مرة فقط ~30MB)...</div>
        <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
    `;

    try {
        const blob = await buildVideoInBrowser({
            imageFiles: state.images.map(i => i.file),
            audioFile: state.audio,
            motionType: document.getElementById('motionType').value,
            transitionType: document.getElementById('transitionType').value,
            duration: parseFloat(document.getElementById('duration').value),
            resolution: document.getElementById('resolution').value,
            onProgress: (pct) => {
                statusEl.innerHTML = `
                    <div>⚙️ جاري الإنشاء... ${pct}%</div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
                `;
            },
        });

        // حفظ في IndexedDB
        const videoId = 'vid_' + Date.now();
        await Storage.saveVideo(videoId, blob, {
            name: `video_${videoId}.mp4`,
            size: blob.size,
            imagesCount: state.images.length,
            hasAudio: !!state.audio,
        });

        // عرض النتيجة
        const url = URL.createObjectURL(blob);
        resultVideo.src = url;
        downloadLink.href = url;
        downloadLink.download = `video_${videoId}.mp4`;
        resultCard.style.display = 'block';

        statusEl.classList.add('success');
        statusEl.innerHTML = `✅ تم إنشاء الفيديو بنجاح! (${(blob.size / 1024 / 1024).toFixed(1)} MB)`;

        await renderSavedVideos();
    } catch (err) {
        console.error(err);
        statusEl.classList.add('error');
        statusEl.textContent = '❌ فشل: ' + err.message;
    } finally {
        generateBtn.disabled = false;
    }
});

// ============ الفيديوهات المحفوظة ============
const savedVideosEl = document.getElementById('savedVideos');

async function renderSavedVideos() {
    const videos = await Storage.getAllVideos();
    if (videos.length === 0) {
        savedVideosEl.innerHTML = '<p class="hint">لا توجد فيديوهات محفوظة بعد</p>';
        return;
    }

    savedVideosEl.innerHTML = '';
    for (const v of videos) {
        const url = URL.createObjectURL(v.blob);
        const div = document.createElement('div');
        div.className = 'saved-item';
        div.innerHTML = `
            <video src="${url}" controls></video>
            <div class="meta">
                ${new Date(v.createdAt).toLocaleString('ar')} —
                ${(v.blob.size / 1024 / 1024).toFixed(1)} MB
            </div>
            <div class="actions">
                <a href="${url}" download="video_${v.id}.mp4">📥 تحميل</a>
                <button class="delete" data-id="${v.id}">🗑️ حذف</button>
            </div>
        `;
        div.querySelector('.delete').addEventListener('click', async () => {
            if (!confirm('حذف هذا الفيديو؟')) return;
            await Storage.deleteVideo(v.id);
            URL.revokeObjectURL(url);
            await renderSavedVideos();
        });
        savedVideosEl.appendChild(div);
    }
}

renderSavedVideos();
