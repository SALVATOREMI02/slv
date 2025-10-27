// coba.js - JavaScript untuk Sistem Monitoring Kehadiran

// Variabel global untuk filter
let currentFilter = {
    active: false,
    jurusan: 'all',
    angkatan: 'all',
    tanggal: null,
    preset: null
};

let currentRecapFilter = {
    jurusan: 'all',
    angkatan: 'all',
    tanggal: null
};

// Variabel untuk smart detection
let lastDataHash = null;
let dataCache = null;
let refreshInterval = null;
let isFirstLoad = true;

// Data jurusan yang tersedia
const availableJurusan = ['Mekatronika', 'Pemesinan', 'Ototronik', 'Animasi'];

// Data forum evaluasi
let forumPosts = JSON.parse(localStorage.getItem('forumPosts')) || [];

// Inisialisasi saat halaman dimuat
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
});

function initializeApp() {
    console.log('🚀 Initializing application...');
    
    // Set tanggal hari ini sebagai default
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('filterTanggal').value = today;
    document.getElementById('recapFilterTanggal').value = today;
    document.getElementById('postTanggal').value = today;
    
    currentFilter.tanggal = today;
    currentRecapFilter.tanggal = today;
    
    // Isi dropdown jurusan secara dinamis
    populateJurusanDropdowns();
    
    // Tampilkan splash screen pertama kali
    showSplashScreen();
    
    // Load forum posts
    loadForumPosts();
    
    // ⭐ PERBAIKAN: Smart auto-refresh dengan delay lebih panjang
    setTimeout(() => {
        // Load data pertama kali
        loadAttendanceData(true);
        
        // Start auto-refresh yang lebih pintar
        refreshInterval = setInterval(() => {
            checkForNewData();
        }, 30000); // 30 detik untuk hemat resources
    }, 1000);
    
    console.log('✅ App initialized');
}

function setupEventListeners() {
    // Event listeners untuk filter
    document.getElementById('applyFilterBtn').addEventListener('click', applyFilters);
    document.getElementById('resetFilterBtn').addEventListener('click', resetFilters);
    document.getElementById('applyRecapFilterBtn').addEventListener('click', applyRecapFilters);
    
    // Event listeners untuk navigation
    document.getElementById('showRecapBtn').addEventListener('click', showRecapPage);
    document.getElementById('showForumBtn').addEventListener('click', showForumPage);
    document.getElementById('backToDashboardBtn').addEventListener('click', showMainDashboard);
    document.getElementById('backToDashboardBtn2').addEventListener('click', showMainDashboard);
    
    // Event listeners untuk controls
    document.getElementById('refreshDataBtn').addEventListener('click', manualRefreshData);
    document.getElementById('printTableBtn').addEventListener('click', printTable);
    
    // Event listeners untuk forum
    document.getElementById('openNewPostBtn').addEventListener('click', openNewPostForm);
    document.getElementById('closePostDetailBtn').addEventListener('click', closePostDetail);
    document.getElementById('closeNewPostBtn').addEventListener('click', closeNewPostForm);
    document.getElementById('cancelPostBtn').addEventListener('click', closeNewPostForm);
    document.getElementById('createPostBtn').addEventListener('click', createNewPost);
    
    // Event listeners untuk perubahan filter (real-time)
    document.getElementById('filterJurusan').addEventListener('change', applyFilters);
    document.getElementById('filterAngkatan').addEventListener('change', applyFilters);
    document.getElementById('filterTanggal').addEventListener('change', applyFilters);
    document.getElementById('recapFilterJurusan').addEventListener('change', applyRecapFilters);
    document.getElementById('recapFilterAngkatan').addEventListener('change', applyRecapFilters);
    document.getElementById('recapFilterTanggal').addEventListener('change', applyRecapFilters);
    
    // Event listeners untuk tombol riwayat
    document.getElementById('showAllDataBtn')?.addEventListener('click', showAllData);
    document.getElementById('showTodayDataBtn')?.addEventListener('click', showTodayData);
    
    // ⭐ PERBAIKAN: Event listener untuk page visibility
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

// ================== SMART DATA LOADING FUNCTIONS ================== //

// ⭐ FUNGSI BARU: Smart data checking - hanya refresh jika ada data baru
async function checkForNewData() {
    try {
        console.log('🔍 Checking for new data...');
        
        const response = await fetch(`presensi.json?t=${Date.now()}`);
        
        if (!response.ok) {
            console.log('❌ Fetch failed, skipping update');
            return;
        }
        
        const newData = await response.json();
        
        if (!Array.isArray(newData)) {
            console.log('❌ Invalid data format, skipping update');
            return;
        }
        
        // Generate hash untuk data baru
        const newHash = generateDataHash(newData);
        
        // Bandingkan dengan hash sebelumnya
        if (newHash === lastDataHash) {
            console.log('✅ No new data detected');
            return; // Tidak ada data baru, keluar
        }
        
        console.log('🔄 New data detected! Updating...');
        
        // Update cache dan hash
        dataCache = newData;
        lastDataHash = newHash;
        
        // Simpan ke localStorage
        localStorage.setItem('attendanceData', JSON.stringify(newData));
        
        // Hitung berapa data baru
        const oldCount = dataCache ? dataCache.length : 0;
        const newCount = newData.length;
        const newRecords = newCount - oldCount;
        
        // Process dan tampilkan data
        processAndDisplayData(newData);
        
        // Tampilkan notifikasi jika ada data baru
        if (newRecords > 0) {
            showMessage(`📊 ${newRecords} data baru ditemukan!`, 'success');
        }
        
        updateLastUpdate();
        
    } catch (error) {
        console.log('❌ Error checking new data:', error.message);
        // Tidak tampilkan error ke user untuk auto-refresh
    }
}

// ⭐ FUNGSI BARU: Manual refresh dengan force
async function manualRefreshData() {
    console.log('🔄 Manual refresh requested');
    showMessage('Memuat data terbaru...', 'success');
    await loadAttendanceData(true);
}

// ⭐ FUNGSI BARU: Handle page visibility change
function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
        console.log('📱 Page became visible, checking for new data...');
        // Check data baru ketika user kembali ke tab
        setTimeout(() => {
            checkForNewData();
        }, 1000);
    }
}

// ⭐ FUNGSI BARU: Process dan display data dengan aman
function processAndDisplayData(data) {
    if (!data || !Array.isArray(data)) {
        console.error('❌ No valid data to process');
        showEmptyState();
        return;
    }
    
    console.log('🖥️ Processing data for display:', data.length, 'records');
    
    // Terapkan filter yang aktif
    const filteredData = filterDataByJurusanAndDate(
        data, 
        currentFilter.jurusan, 
        currentFilter.angkatan,
        currentFilter.tanggal
    );
    
    console.log('🎯 Filtered data:', Object.keys(filteredData).length, 'records');
    
    // Tampilkan data
    displayData(filteredData);
}

// Fungsi load data utama (untuk first load dan manual refresh)
async function loadAttendanceData(forceRefresh = false) {
    try {
        console.log('🚀 Loading attendance data...', forceRefresh ? '(Force refresh)' : '');
        
        if (forceRefresh) {
            showLoading();
        }
        
        const response = await fetch(`presensi.json?t=${Date.now()}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!Array.isArray(data)) {
            throw new Error('Invalid data format');
        }
        
        console.log('✅ Data loaded successfully:', data.length, 'records');
        
        // Update cache dan hash
        dataCache = data;
        lastDataHash = generateDataHash(data);
        
        // Simpan ke localStorage
        localStorage.setItem('attendanceData', JSON.stringify(data));
        
        // Process dan tampilkan data
        processAndDisplayData(data);
        
        updateLastUpdate();
        
        if (forceRefresh || isFirstLoad) {
            showMessage('✅ Data berhasil dimuat', 'success');
            isFirstLoad = false;
        }
        
    } catch (error) {
        console.error('❌ Error loading data:', error);
        handleDataLoadError(error);
    } finally {
        hideLoading();
    }
}

// ⭐ FUNGSI BARU: Handle error loading data
function handleDataLoadError(error) {
    // Coba gunakan cache yang ada
    const cachedData = localStorage.getItem('attendanceData');
    if (cachedData) {
        try {
            const data = JSON.parse(cachedData);
            console.log('🔄 Using cached data due to error');
            processAndDisplayData(data);
            
            if (!isFirstLoad) {
                showMessage('⚠ Menggunakan data cache - ' + error.message, 'warning');
            }
            return;
        } catch (parseError) {
            console.error('❌ Error parsing cached data:', parseError);
        }
    }
    
    // Jika tidak ada cache, tampilkan error
    showError('Gagal memuat data: ' + error.message);
}

// ⭐ FUNGSI BARU: Tampilan state kosong
function showEmptyState() {
    const tableBody = document.getElementById('tableBody');
    const totalSpan = document.getElementById('total');
    const todaySpan = document.getElementById('today');
    
    if (tableBody) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <div>📭</div>
                    <h3>Belum ada data absensi</h3>
                    <p>Data absensi akan muncul setelah kartu RFID dibaca</p>
                    <button onclick="manualRefreshData()" class="btn-secondary" style="margin-top: 10px;">
                        🔄 Refresh Data
                    </button>
                </td>
            </tr>
        `;
    }
    
    if (totalSpan) totalSpan.textContent = '0';
    if (todaySpan) todaySpan.textContent = '0';
}

// Fungsi untuk generate hash data
function generateDataHash(data) {
    if (!data || !Array.isArray(data)) return 'empty';
    
    // Gunakan kombinasi jumlah data dan timestamp terbaru
    const timestamps = data.map(item => item.timestamp).filter(Boolean);
    if (timestamps.length === 0) return `count-${data.length}`;
    
    const latestTimestamp = Math.max(...timestamps.map(ts => new Date(ts).getTime()));
    return `count-${data.length}-time-${latestTimestamp}`;
}

// ================== INITIALIZATION FUNCTIONS ================== //

function populateJurusanDropdowns() {
    const filterJurusan = document.getElementById('filterJurusan');
    const recapFilterJurusan = document.getElementById('recapFilterJurusan');
    const postJurusan = document.getElementById('postJurusan');
    
    if (filterJurusan && recapFilterJurusan && postJurusan) {
        // Kosongkan dulu
        filterJurusan.innerHTML = '<option value="all">Semua Jurusan</option>';
        recapFilterJurusan.innerHTML = '<option value="all">Semua Jurusan</option>';
        postJurusan.innerHTML = '<option value="all">Semua Jurusan</option>';
        
        // Isi dengan jurusan yang tersedia
        availableJurusan.forEach(jurusan => {
            filterJurusan.innerHTML += `<option value="${jurusan}">${jurusan}</option>`;
            recapFilterJurusan.innerHTML += `<option value="${jurusan}">${jurusan}</option>`;
            postJurusan.innerHTML += `<option value="${jurusan}">${jurusan}</option>`;
        });
    }
}

// Splash Screen Functions
function showSplashScreen() {
    const splashScreen = document.getElementById('splashScreen');
    const mainDashboard = document.getElementById('mainDashboard');
    
    if (splashScreen && mainDashboard) {
        splashScreen.classList.remove('hidden');
        mainDashboard.classList.add('hidden');
        
        // Set timeout untuk pindah ke dashboard setelah 4.5 detik
        setTimeout(() => {
            splashScreen.style.opacity = '0';
            splashScreen.style.transform = 'scale(1.1)';
            
            setTimeout(() => {
                splashScreen.classList.add('hidden');
                mainDashboard.classList.remove('hidden');
            }, 800);
        }, 4500);
    }
}

// ================== NAVIGATION FUNCTIONS ================== //

function showRecapPage() {
    const mainDashboard = document.getElementById('mainDashboard');
    const recapPage = document.getElementById('recapPage');
    
    if (mainDashboard && recapPage) {
        mainDashboard.classList.add('hidden');
        recapPage.classList.remove('hidden');
        
        // Load data rekap
        calculateAndDisplayRecapFromStorage();
    }
}

function showMainDashboard() {
    const mainDashboard = document.getElementById('mainDashboard');
    const recapPage = document.getElementById('recapPage');
    const forumPage = document.getElementById('forumPage');
    
    if (recapPage) recapPage.classList.add('hidden');
    if (forumPage) forumPage.classList.add('hidden');
    if (mainDashboard) mainDashboard.classList.remove('hidden');
}

function showForumPage() {
    const mainDashboard = document.getElementById('mainDashboard');
    const forumPage = document.getElementById('forumPage');
    
    if (mainDashboard && forumPage) {
        mainDashboard.classList.add('hidden');
        forumPage.classList.remove('hidden');
        
        // Load forum posts
        loadForumPosts();
    }
}

// ================== FORUM EVALUASI FUNCTIONS ================== //

function loadForumPosts() {
    const forumContainer = document.getElementById('forumPosts');
    if (!forumContainer) return;

    if (forumPosts.length === 0) {
        forumContainer.innerHTML = `
            <div class="empty-forum">
                <div style="font-size: 3rem; margin-bottom: 1rem;">💬</div>
                <h3>Belum ada diskusi</h3>
                <p>Jadilah yang pertama memulai diskusi tentang evaluasi absensi</p>
            </div>
        `;
        return;
    }

    let html = '';
    forumPosts.forEach((post, index) => {
        const replyCount = post.replies ? post.replies.length : 0;
        
        html += `
            <div class="forum-post" onclick="openPostDetail(${index})">
                <div class="post-header">
                    <div class="post-author">
                        <div class="author-avatar">${post.author.charAt(0).toUpperCase()}</div>
                        <div>
                            <strong>${post.author}</strong>
                            <div class="post-date">${formatForumDate(post.date)}</div>
                        </div>
                    </div>
                    <div class="post-category ${post.category}">${getCategoryLabel(post.category)}</div>
                </div>
                <div class="post-title">${post.title}</div>
                <div class="post-content">${post.content}</div>
                <div class="post-footer">
                    <div class="post-stats">
                        <span class="reply-count">💬 ${replyCount} balasan</span>
                        <span class="like-count">👍 ${post.likes || 0}</span>
                    </div>
                    <div class="post-jurusan">${post.jurusan || 'Semua Jurusan'}</div>
                </div>
            </div>
        `;
    });

    forumContainer.innerHTML = html;
}

function openPostDetail(postIndex) {
    const post = forumPosts[postIndex];
    const modal = document.getElementById('postDetailModal');
    const modalContent = document.getElementById('postDetailContent');
    
    if (!modal || !modalContent) return;

    const replies = post.replies || [];
    
    modalContent.innerHTML = `
        <div class="post-detail">
            <div class="post-header">
                <div class="post-author">
                    <div class="author-avatar">${post.author.charAt(0).toUpperCase()}</div>
                    <div>
                        <strong>${post.author}</strong>
                        <div class="post-date">${formatForumDate(post.date)}</div>
                    </div>
                </div>
                <div class="post-category ${post.category}">${getCategoryLabel(post.category)}</div>
            </div>
            <div class="post-title">${post.title}</div>
            <div class="post-content">${post.content}</div>
            <div class="post-meta">
                <span class="post-jurusan">Jurusan: ${post.jurusan || 'Semua Jurusan'}</span>
                <span class="post-date">Tanggal: ${post.tanggal || 'Hari Ini'}</span>
            </div>
            
            <div class="replies-section">
                <h4>💬 Balasan (${replies.length})</h4>
                ${replies.length > 0 ? 
                    replies.map(reply => `
                        <div class="reply">
                            <div class="reply-author">
                                <div class="author-avatar small">${reply.author.charAt(0).toUpperCase()}</div>
                                <div>
                                    <strong>${reply.author}</strong>
                                    <div class="reply-date">${formatForumDate(reply.date)}</div>
                                </div>
                            </div>
                            <div class="reply-content">${reply.content}</div>
                        </div>
                    `).join('') : 
                    '<div class="no-replies">Belum ada balasan</div>'
                }
            </div>
            
            <div class="reply-form">
                <div class="form-group">
                    <label for="replyAuthor">Nama Anda:</label>
                    <input type="text" id="replyAuthor" placeholder="Masukkan nama Anda" value="Guru">
                </div>
                <textarea id="replyContent" placeholder="Tulis balasan Anda..." rows="3"></textarea>
                <button onclick="addReply(${postIndex})" class="btn-primary">Kirim Balasan</button>
            </div>
        </div>
    `;
    
    modal.classList.remove('hidden');
}

function closePostDetail() {
    const modal = document.getElementById('postDetailModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function addReply(postIndex) {
    const replyContent = document.getElementById('replyContent');
    const replyAuthor = document.getElementById('replyAuthor');
    
    if (!replyContent || !replyContent.value.trim()) {
        showMessage('Harap isi balasan', 'warning');
        return;
    }
    
    if (!replyAuthor || !replyAuthor.value.trim()) {
        showMessage('Harap isi nama Anda', 'warning');
        return;
    }

    if (!forumPosts[postIndex].replies) {
        forumPosts[postIndex].replies = [];
    }

    const newReply = {
        author: replyAuthor.value.trim(),
        content: replyContent.value.trim(),
        date: new Date().toISOString()
    };

    forumPosts[postIndex].replies.push(newReply);
    saveForumPosts();
    
    replyContent.value = '';
    openPostDetail(postIndex); // Refresh modal
    showMessage('Balasan berhasil dikirim', 'success');
}

function openNewPostForm() {
    const modal = document.getElementById('newPostModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeNewPostForm() {
    const modal = document.getElementById('newPostModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function createNewPost() {
    const title = document.getElementById('postTitle');
    const content = document.getElementById('postContent');
    const category = document.getElementById('postCategory');
    const jurusan = document.getElementById('postJurusan');
    const tanggal = document.getElementById('postTanggal');
    const author = document.getElementById('postAuthor');

    if (!title || !content || !category || !jurusan || !tanggal || !author) return;

    if (!title.value.trim() || !content.value.trim()) {
        showMessage('Harap isi judul dan konten', 'warning');
        return;
    }
    
    if (!author.value.trim()) {
        showMessage('Harap isi nama Anda', 'warning');
        return;
    }

    const newPost = {
        title: title.value.trim(),
        content: content.value.trim(),
        category: category.value,
        jurusan: jurusan.value === 'all' ? null : jurusan.value,
        tanggal: tanggal.value,
        author: author.value.trim(),
        date: new Date().toISOString(),
        likes: 0,
        replies: []
    };

    forumPosts.unshift(newPost);
    saveForumPosts();
    
    // Reset form
    title.value = '';
    content.value = '';
    category.value = 'evaluasi';
    jurusan.value = 'all';
    tanggal.value = new Date().toISOString().split('T')[0];
    author.value = '';
    
    closeNewPostForm();
    loadForumPosts();
    showMessage('Diskusi berhasil dibuat', 'success');
}

function saveForumPosts() {
    localStorage.setItem('forumPosts', JSON.stringify(forumPosts));
}

function formatForumDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Baru saja';
    if (diffMins < 60) return `${diffMins} menit lalu`;
    if (diffHours < 24) return `${diffHours} jam lalu`;
    if (diffDays === 1) return 'Kemarin';
    if (diffDays < 7) return `${diffDays} hari lalu`;
    
    return date.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

function getCategoryLabel(category) {
    const labels = {
        'evaluasi': '📊 Evaluasi',
        'masalah': '⚠ Masalah',
        'saran': '💡 Saran',
        'pencapaian': '🎉 Pencapaian'
    };
    return labels[category] || category;
}

// ================== FILTER FUNCTIONS ================== //

function applyFilters() {
    const jurusan = document.getElementById('filterJurusan').value;
    const angkatan = document.getElementById('filterAngkatan').value;
    const tanggal = document.getElementById('filterTanggal').value;
    
    console.log('🎯 Applying filters:', {
        jurusan: jurusan,
        angkatan: angkatan,
        tanggal: tanggal
    });
    
    currentFilter.jurusan = jurusan;
    currentFilter.angkatan = angkatan;
    currentFilter.tanggal = tanggal;
    currentFilter.active = true;
    
    updateFilterInfo();
    
    // ⭐ PERBAIKAN: Gunakan data cache yang sudah ada
    if (dataCache) {
        processAndDisplayData(dataCache);
    } else {
        loadAttendanceData(false);
    }
}

function applyRecapFilters() {
    const jurusan = document.getElementById('recapFilterJurusan').value;
    const angkatan = document.getElementById('recapFilterAngkatan').value;
    const tanggal = document.getElementById('recapFilterTanggal').value;
    
    console.log('🎯 Applying recap filters:', {
        jurusan: jurusan,
        angkatan: angkatan,
        tanggal: tanggal
    });
    
    currentRecapFilter.jurusan = jurusan;
    currentRecapFilter.angkatan = angkatan;
    currentRecapFilter.tanggal = tanggal;
    
    updateRecapFilterInfo();
    calculateAndDisplayRecapFromStorage();
}

function resetFilters() {
    const today = new Date().toISOString().split('T')[0];
    
    document.getElementById('filterJurusan').value = 'all';
    document.getElementById('filterAngkatan').value = 'all';
    document.getElementById('filterTanggal').value = today;
    
    currentFilter.jurusan = 'all';
    currentFilter.angkatan = 'all';
    currentFilter.tanggal = today;
    currentFilter.active = false;
    
    updateFilterInfo();
    
    // ⭐ PERBAIKAN: Gunakan data cache yang sudah ada
    if (dataCache) {
        processAndDisplayData(dataCache);
    } else {
        loadAttendanceData(false);
    }
    
    showMessage(' Filter telah direset', 'success');
}

function updateFilterInfo() {
    const filterInfo = document.getElementById('filterInfo');
    if (!filterInfo) return;
    
    let infoText = 'Menampilkan: ';
    
    if (currentFilter.jurusan === 'all') {
        infoText += 'Semua Jurusan';
    } else {
        infoText += `Jurusan ${currentFilter.jurusan}`;
    }
    
    if (currentFilter.angkatan === 'all') {
        infoText += ' - Semua Angkatan';
    } else {
        infoText += ` - Angkatan ${currentFilter.angkatan}`;
    }
    
    const today = new Date().toISOString().split('T')[0];
    if (currentFilter.tanggal === today) {
        infoText += ' - Hari Ini';
    } else if (currentFilter.tanggal) {
        const dateObj = new Date(currentFilter.tanggal);
        infoText += ` - ${dateObj.toLocaleDateString('id-ID')}`;
    } else {
        infoText += ' - Semua Tanggal';
    }
    
    filterInfo.textContent = infoText;
}

function updateRecapFilterInfo() {
    const filterInfo = document.getElementById('recapFilterInfo');
    if (!filterInfo) return;
    
    let infoText = 'Menampilkan: Rekap ';
    
    if (currentRecapFilter.jurusan === 'all') {
        infoText += 'Semua Jurusan';
    } else {
        infoText += `Jurusan ${currentRecapFilter.jurusan}`;
    }
    
    if (currentRecapFilter.angkatan === 'all') {
        infoText += ' - Semua Angkatan';
    } else {
        infoText += ` - Angkatan ${currentRecapFilter.angkatan}`;
    }
    
    const today = new Date().toISOString().split('T')[0];
    if (currentRecapFilter.tanggal === today) {
        infoText += ' - Hari Ini';
    } else if (currentRecapFilter.tanggal) {
        const dateObj = new Date(currentRecapFilter.tanggal);
        infoText += ` - ${dateObj.toLocaleDateString('id-ID')}`;
    } else {
        infoText += ' - Semua Tanggal';
    }
    
    filterInfo.textContent = infoText;
}

// ================== DATA PROCESSING FUNCTIONS ================== //

function filterDataByJurusanAndDate(data, jurusan, angkatan, tanggal) {
    if (!data || !Array.isArray(data)) return {};
    
    const filteredData = {};
    const targetDate = tanggal || new Date().toISOString().split('T')[0];
    
    console.log('🔍 Filtering data for date:', targetDate);
    console.log('📊 Total data records:', data.length);
    
    // Kelompokkan data berdasarkan card_id dan ambil data TERBARU untuk tanggal yang dipilih
    const latestData = {};
    
    // Urutkan data berdasarkan timestamp terbaru
    const sortedData = [...data].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    console.log('📅 Data dengan tanggal yang sesuai:');
    
    sortedData.forEach(absen => {
        if (absen.tanggal === targetDate) {
            const cardId = absen.card_id;
            
            console.log(`   ✅ ${absen.nama} - ${absen.tanggal} ${absen.waktu_presensi} - ${absen.status}`);
            
            // Ambil data terbaru untuk setiap card_id pada tanggal yang dipilih
            if (!latestData[cardId] || new Date(absen.timestamp) > new Date(latestData[cardId].timestamp)) {
                latestData[cardId] = absen;
            }
        }
    });
    
    console.log('✅ Latest data untuk tanggal', targetDate + ':', Object.keys(latestData).length, 'records');
    
    // Sekarang filter berdasarkan jurusan dan angkatan
    Object.values(latestData).forEach(absen => {
        // Filter jurusan
        const jurusanMatch = jurusan === 'all' || absen.jurusan === jurusan;
        
        // Filter angkatan
        let angkatanMatch = angkatan === 'all';
        if (angkatan !== 'all') {
            const targetAngkatan = angkatan.toString();
            const actualAngkatan = absen.angkatan ? absen.angkatan.toString() : null;
            angkatanMatch = actualAngkatan === targetAngkatan;
        }
        
        if (jurusanMatch && angkatanMatch) {
            // Convert ke format yang diharapkan
            filteredData[absen.card_id] = {
                nama: absen.nama,
                jurusan: absen.jurusan,
                angkatan: absen.angkatan || "-",
                time: absen.waktu_presensi,
                attributes: {
                    'nama tag': absen.atribut_terdeteksi.includes('NAME TAG'),
                    'pin cita cita': absen.atribut_terdeteksi.includes('PIN CITA CITA'),
                    'idCard': absen.atribut_terdeteksi.includes('ID CARD')
                },
                status: absen.status,
                atribut_terdeteksi: absen.atribut_terdeteksi,
                confidence_scores: absen.confidence_scores
            };
        }
    });
    
    console.log('🎯 Final filtered result:', Object.keys(filteredData).length, 'records');
    return filteredData;
}

// ================== DISPLAY FUNCTIONS ================== //

function displayData(data) {
    const tableBody = document.getElementById('tableBody');
    const totalSpan = document.getElementById('total');
    const todaySpan = document.getElementById('today');
    const jurusanCountSpan = document.getElementById('jurusanCount');
    const jurusanLabelSpan = document.getElementById('jurusanLabel');
    
    console.log('🖥️ Displaying data to table:', data);
    
    if (!tableBody) {
        console.error('❌ Table body element not found!');
        return;
    }
    
    // Validasi data
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        console.log('📭 No data to display, showing empty state');
        showEmptyState();
        return;
    }

    let html = '';
    let counter = 1;
    let totalCount = 0;
    let jurusanCount = 0;
    const jurusanSet = new Set();
    
    try {
        const sortedData = Object.entries(data).sort((a, b) => {
            return new Date(b[1].time) - new Date(a[1].time);
        });
        
        console.log('📊 Sorted data entries:', sortedData.length);
        
        for (const [cardId, student] of sortedData) {
            if (!student || !student.nama) {
                console.warn('⚠️ Invalid student data:', student);
                continue;
            }
            
            totalCount++;
            jurusanSet.add(student.jurusan);
            
            // Analisis atribut
            const attributeStatus = checkAttributeCompleteness(student.attributes);
            const missingAttributes = getMissingAttributes(student.attributes);
            
            // SEMUA PRESENSI DITERIMA - yang beda hanya status atribut
            const isComplete = attributeStatus.complete;
            
            // Status atribut
            let attributeBadge = '';
            let attributeDetails = '';
            
            if (isComplete) {
                attributeBadge = '<span class="badge badge-success">Lengkap</span>';
            } else {
                attributeBadge = '<span class="badge badge-warning">Tidak Lengkap</span>';
                attributeDetails = `<br><small style="color: var(--warning);">⚠ ${missingAttributes}</small>`;
            }
            
            // Status waktu (untuk semua data)
            const absenTime = new Date(student.time);
            const targetTime = new Date(absenTime);
            targetTime.setHours(6, 45, 0, 0);
            const isOnTime = absenTime <= targetTime;
            
            let timeBadge = '';
            if (isOnTime) {
                timeBadge = '<span class="badge badge-success">Tepat Waktu</span>';
            } else {
                const timeDiff = absenTime - targetTime;
                const diffMinutes = Math.floor(Math.abs(timeDiff) / (1000 * 60));
                timeBadge = `<span class="badge badge-warning">Terlambat</span><br><small style="color: var(--warning);">+${diffMinutes} menit</small>`;
            }
            
            // Status presensi - SEMUA DITERIMA, hanya info atribut yang berbeda
            const statusBadge = '<span class="badge badge-success">HADIR</span>';
            
            html += `
                <tr>
                    <td>${counter}</td>
                    <td><strong>${cardId}</strong></td>
                    <td>
                        ${student.nama}
                        ${attributeDetails}
                    </td>
                    <td>${student.jurusan}</td>
                    <td>${student.angkatan}</td>
                    <td>${formatDateTime(student.time)}</td>
                    <td>${statusBadge}</td>
                    <td>
                        ${timeBadge}
                        <br>
                        ${attributeBadge}
                    </td>
                </tr>
            `;
            counter++;
        }
        
        jurusanCount = jurusanSet.size;
        console.log('✅ Rendered', totalCount, 'rows to table');
        
    } catch (error) {
        console.error('❌ Error rendering table:', error);
        html = `
            <tr>
                <td colspan="8" style="color: var(--danger); text-align: center; padding: 20px;">
                    ❌ Error menampilkan data: ${error.message}
                </td>
            </tr>
        `;
    }
    
    tableBody.innerHTML = html;
    
    // Update counters
    if (totalSpan) totalSpan.textContent = totalCount;
    if (todaySpan) todaySpan.textContent = totalCount;
    if (jurusanCountSpan) jurusanCountSpan.textContent = jurusanCount;
    if (jurusanLabelSpan) jurusanLabelSpan.textContent = jurusanCount === 1 ? 'Jurusan' : 'Jurusan Terfilter';
    
    console.log('🎉 Table update completed');
}

// ================== HISTORY/RECAP FUNCTIONS ================== //

function showAllHistoryData() {
    const storedData = localStorage.getItem('attendanceData');
    if (!storedData) {
        showMessage('❌ Tidak ada data yang tersimpan', 'warning');
        return;
    }
    
    const data = JSON.parse(storedData);
    console.log('📚 Menampilkan semua data riwayat:', data.length, 'records');
    
    // Update filter info untuk menunjukkan semua data
    const filterInfo = document.getElementById('filterInfo');
    if (filterInfo) {
        filterInfo.textContent = 'Menampilkan: Semua Data Riwayat (' + data.length + ' records)';
    }
    
    // Tampilkan dalam format tabel khusus riwayat
    displayHistoryData(data);
}

function displayHistoryData(data) {
    const tableBody = document.getElementById('tableBody');
    const totalSpan = document.getElementById('total');
    const todaySpan = document.getElementById('today');
    const jurusanCountSpan = document.getElementById('jurusanCount');
    const jurusanLabelSpan = document.getElementById('jurusanLabel');
    
    if (!data || data.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">
                    <div>📭</div>
                    <h3>Belum ada data riwayat absensi</h3>
                    <p>Data riwayat akan muncul setelah ada presensi</p>
                </td>
            </tr>
        `;
        totalSpan.textContent = '0';
        todaySpan.textContent = '0';
        if (jurusanCountSpan) jurusanCountSpan.textContent = '0';
        if (jurusanLabelSpan) jurusanLabelSpan.textContent = 'Jurusan';
        return;
    }

    let html = '';
    let counter = 1;
    let totalCount = data.length;
    let jurusanCount = 0;
    const jurusanSet = new Set();
    
    // Urutkan data berdasarkan timestamp terbaru
    const sortedData = [...data].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    for (const record of sortedData) {
        jurusanSet.add(record.jurusan);
        
        // Analisis atribut
        const attributeStatus = checkAttributeCompleteness({
            'nama tag': record.atribut_terdeteksi.includes('NAME TAG'),
            'pin cita cita': record.atribut_terdeteksi.includes('PIN CITA CITA'),
            'idCard': record.atribut_terdeteksi.includes('ID CARD')
        });
        
        const missingAttributes = getMissingAttributes({
            'nama tag': record.atribut_terdeteksi.includes('NAME TAG'),
            'pin cita cita': record.atribut_terdeteksi.includes('PIN CITA CITA'),
            'idCard': record.atribut_terdeteksi.includes('ID CARD')
        });
        
        // Status presensi
        const isSuccess = record.status === "BERHASIL";
        const statusBadge = isSuccess ? 
            '<span class="badge badge-success">BERHASIL</span>' : 
            '<span class="badge badge-danger">GAGAL</span>';
        
        // Status atribut
        let attributeBadge = '';
        let attributeDetails = '';
        
        if (isSuccess) {
            attributeBadge = attributeStatus.complete ? 
                '<span class="badge badge-success">Lengkap</span>' : 
                '<span class="badge badge-warning">Tidak Lengkap</span>';
        } else {
            attributeBadge = '<span class="badge badge-danger">Atribut Kurang</span>';
            attributeDetails = `<br><small style="color: var(--danger);">❌ ${missingAttributes}</small>`;
        }
        
        // Status waktu
        let timeBadge = '';
        const absenTime = new Date(record.waktu_presensi);
        const targetTime = new Date(absenTime);
        targetTime.setHours(6, 45, 0, 0);
        const isOnTime = absenTime <= targetTime;
        
        if (isSuccess) {
            timeBadge = isOnTime ? 
                '<span class="badge badge-success">Tepat Waktu</span>' : 
                '<span class="badge badge-warning">Terlambat</span>';
        } else {
            timeBadge = '<span class="badge badge-secondary">-</span>';
        }
        
        html += `
            <tr>
                <td>${counter}</td>
                <td><strong>${record.card_id}</strong></td>
                <td>
                    ${record.nama}
                    ${attributeDetails}
                </td>
                <td>${record.jurusan}</td>
                <td>${record.angkatan || "-"}</td>
                <td>${formatDate(record.tanggal)}</td>
                <td>${formatDateTime(record.waktu_presensi)}</td>
                <td>${statusBadge}</td>
                <td>
                    ${timeBadge}
                    <br>
                    ${attributeBadge}
                </td>
            </tr>
        `;
        counter++;
    }
    
    jurusanCount = jurusanSet.size;
    
    tableBody.innerHTML = html;
    totalSpan.textContent = totalCount;
    todaySpan.textContent = totalCount;
    if (jurusanCountSpan) jurusanCountSpan.textContent = jurusanCount;
    if (jurusanLabelSpan) jurusanLabelSpan.textContent = 'Jurusan';
}

// ================== ENHANCED FILTER FUNCTIONS ================== //

function showAllData() {
    // Set filter ke "all" untuk semua parameter
    currentFilter.jurusan = 'all';
    currentFilter.angkatan = 'all';
    currentFilter.tanggal = null;
    currentFilter.active = true;
    
    // Update UI
    document.getElementById('filterJurusan').value = 'all';
    document.getElementById('filterAngkatan').value = 'all';
    document.getElementById('filterTanggal').value = '';
    
    // Tampilkan semua data
    showAllHistoryData();
    showMessage('📚 Menampilkan semua data riwayat', 'success');
}

function showTodayData() {
    // Set filter ke hari ini
    const today = new Date().toISOString().split('T')[0];
    currentFilter.tanggal = today;
    
    // Update UI
    document.getElementById('filterTanggal').value = today;
    
    // Load data dengan filter hari ini
    if (dataCache) {
        processAndDisplayData(dataCache);
    } else {
        loadAttendanceData();
    }
    showMessage('📅 Menampilkan data hari ini', 'success');
}

// ================== ATTRIBUTE ANALYSIS FUNCTIONS ================== //

function checkAttributeCompleteness(attributes) {
    if (!attributes || Object.keys(attributes).length === 0) {
        return {
            complete: false,
            completeCount: 0,
            totalCount: 0,
            percentage: 0
        };
    }
    
    const totalAttributes = Object.keys(attributes).length;
    const completeAttributes = Object.values(attributes).filter(Boolean).length;
    const complete = completeAttributes === totalAttributes;
    
    return {
        complete: complete,
        completeCount: completeAttributes,
        totalCount: totalAttributes,
        percentage: Math.round((completeAttributes / totalAttributes) * 100)
    };
}

function getMissingAttributes(attributes) {
    if (!attributes) return "Tidak ada atribut";
    
    const missing = [];
    if (!attributes['nama tag']) missing.push("Name Tag");
    if (!attributes['pin cita cita']) missing.push("Pin Cita-cita");
    if (!attributes['idCard']) missing.push("ID Card");
    
    return missing.length > 0 ? missing.join(", ") : "Semua atribut lengkap";
}

// ================== RECAP FUNCTIONS ================== //

function calculateAndDisplayRecap(data) {
    // Filter data untuk rekap berdasarkan filter yang aktif
    const filteredData = filterDataByJurusanAndDate(
        data, 
        currentRecapFilter.jurusan, 
        currentRecapFilter.angkatan,
        currentRecapFilter.tanggal
    );
    
    updateRecapStats(filteredData);
    updateRecapTable(filteredData);
    
    // Jika menampilkan semua jurusan, tampilkan statistik per jurusan
    if (currentRecapFilter.jurusan === 'all') {
        const jurusanData = calculateJurusanStats(filteredData);
        displayJurusanStats(jurusanData);
        updateJurusanComparisonChart(jurusanData);
    } else {
        // Jika filter jurusan spesifik
        const jurusanStats = document.getElementById('jurusanStats');
        const comparisonChart = document.getElementById('jurusanComparisonChart');
        
        if (jurusanStats) {
            jurusanStats.innerHTML = '<div class="no-data">Menampilkan data untuk jurusan ' + currentRecapFilter.jurusan + '</div>';
        }
        if (comparisonChart) {
            comparisonChart.innerHTML = '<div style="text-align: center; color: var(--gray); padding: 20px;">Menampilkan data jurusan ' + currentRecapFilter.jurusan + '</div>';
        }
    }
}

function calculateAndDisplayRecapFromStorage() {
    const storedData = localStorage.getItem('attendanceData');
    if (storedData) {
        const data = JSON.parse(storedData);
        calculateAndDisplayRecap(data);
    }
}

function calculateJurusanStats(data) {
    const jurusanData = {};
    
    // Inisialisasi semua jurusan yang tersedia
    availableJurusan.forEach(jurusan => {
        jurusanData[jurusan] = { 
            total: 0, 
            onTime: 0, 
            late: 0,
            completeAttributes: 0,
            incompleteAttributes: 0
        };
    });
    
    Object.values(data).forEach(student => {
        const jurusan = student.jurusan;
        
        // Jika jurusan tidak ada dalam list, tambahkan secara dinamis
        if (!jurusanData[jurusan]) {
            jurusanData[jurusan] = { 
                total: 0, 
                onTime: 0, 
                late: 0,
                completeAttributes: 0,
                incompleteAttributes: 0
            };
        }
        
        jurusanData[jurusan].total++;
        
        // Hitung ketepatan waktu untuk semua data
        const absenTime = new Date(student.time);
        const targetTime = new Date(absenTime);
        targetTime.setHours(6, 45, 0, 0);
        
        if (absenTime <= targetTime) {
            jurusanData[jurusan].onTime++;
        } else {
            jurusanData[jurusan].late++;
        }
        
        // Hitung kelengkapan atribut
        const attributeStatus = checkAttributeCompleteness(student.attributes);
        if (attributeStatus.complete) {
            jurusanData[jurusan].completeAttributes++;
        } else {
            jurusanData[jurusan].incompleteAttributes++;
        }
    });
    
    return jurusanData;
}

function displayJurusanStats(jurusanData) {
    const container = document.getElementById('jurusanStats');
    if (!container) return;
    
    let html = '';
    let hasData = false;
    
    for (const [jurusan, stats] of Object.entries(jurusanData)) {
        if (stats.total > 0) {
            hasData = true;
            const onTimePercent = Math.round((stats.onTime / stats.total) * 100);
            const completeAttrPercent = Math.round((stats.completeAttributes / stats.total) * 100);
            
            html += `
                <div class="jurusan-stat-card">
                    <div class="jurusan-name">${jurusan}</div>
                    <h4>${stats.total}</h4>
                    <div class="jurusan-details">
                        <div>⏰ Tepat Waktu: ${stats.onTime} (${onTimePercent}%)</div>
                        <div>📋 Atribut Lengkap: ${stats.completeAttributes} (${completeAttrPercent}%)</div>
                        <div>⚠ Atribut Kurang: ${stats.incompleteAttributes}</div>
                    </div>
                </div>
            `;
        }
    }
    
    if (!hasData) {
        html = '<div class="no-data">Tidak ada data jurusan untuk tanggal yang dipilih</div>';
    }
    
    container.innerHTML = html;
}

function updateJurusanComparisonChart(jurusanData) {
    const chartContainer = document.getElementById('jurusanComparisonChart');
    if (!chartContainer) return;
    
    const jurusanWithData = Object.entries(jurusanData).filter(([_, stats]) => stats.total > 0);
    
    if (jurusanWithData.length === 0) {
        chartContainer.innerHTML = '<div style="text-align: center; color: var(--gray); padding: 20px;">Tidak ada data perbandingan</div>';
        return;
    }
    
    const maxTotal = Math.max(...jurusanWithData.map(([_, stats]) => stats.total));
    
    let html = '';
    jurusanWithData.forEach(([jurusan, stats]) => {
        const height = (stats.total / maxTotal) * 100;
        const completePercent = Math.round((stats.completeAttributes / stats.total) * 100);
        
        html += `
            <div class="bar" style="height: ${height}%;" title="${jurusan}: ${stats.total} siswa (${completePercent}% atribut lengkap)">
                <div class="bar-value">${stats.total}</div>
                <div class="bar-label">${jurusan}</div>
            </div>
        `;
    });
    
    chartContainer.innerHTML = html;
}

function updateRecapStats(todayData) {
    const recapTodayTotal = document.getElementById('recapTodayTotal');
    const recapOnTime = document.getElementById('recapOnTime');
    const recapLate = document.getElementById('recapLate');
    const recapCompleteAttr = document.getElementById('recapCompleteAttr');
    const recapIncompleteAttr = document.getElementById('recapIncompleteAttr');
    const onTimePercentage = document.getElementById('onTimePercentage');
    const latePercentage = document.getElementById('latePercentage');
    const completeAttrPercentage = document.getElementById('completeAttrPercentage');

    if (!recapTodayTotal || !recapOnTime || !recapLate || !recapCompleteAttr || !recapIncompleteAttr) return;

    const total = Object.keys(todayData).length;
    let onTimeCount = 0;
    let lateCount = 0;
    let completeAttrCount = 0;
    let incompleteAttrCount = 0;

    Object.values(todayData).forEach(student => {
        const absenTime = new Date(student.time);
        const targetTime = new Date(absenTime);
        targetTime.setHours(6, 45, 0, 0);

        if (absenTime <= targetTime) {
            onTimeCount++;
        } else {
            lateCount++;
        }
        
        const attributeStatus = checkAttributeCompleteness(student.attributes);
        if (attributeStatus.complete) {
            completeAttrCount++;
        } else {
            incompleteAttrCount++;
        }
    });

    recapTodayTotal.textContent = total;
    recapOnTime.textContent = onTimeCount;
    recapLate.textContent = lateCount;
    recapCompleteAttr.textContent = completeAttrCount;
    recapIncompleteAttr.textContent = incompleteAttrCount;

    const onTimePercent = total > 0 ? Math.round((onTimeCount / total) * 100) : 0;
    const latePercent = total > 0 ? Math.round((lateCount / total) * 100) : 0;
    const completeAttrPercent = total > 0 ? Math.round((completeAttrCount / total) * 100) : 0;

    if (onTimePercentage) onTimePercentage.textContent = `${onTimePercent}%`;
    if (latePercentage) latePercentage.textContent = `${latePercent}%`;
    if (completeAttrPercentage) completeAttrPercentage.textContent = `${completeAttrPercent}%`;

    updateProgressRing(completeAttrPercent);
}

function updateRecapTable(todayData) {
    const recapTableBody = document.getElementById('recapTableBody');
    if (!recapTableBody) return;

    if (!todayData || Object.keys(todayData).length === 0) {
        recapTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <div>📭</div>
                    <h3>Belum ada data absensi</h3>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    
    const sortedData = Object.entries(todayData).sort((a, b) => {
        return new Date(a[1].time) - new Date(b[1].time);
    });

    sortedData.forEach(([cardId, student]) => {
        const attributeStatus = checkAttributeCompleteness(student.attributes);
        const missingAttributes = getMissingAttributes(student.attributes);
        
        const absenTime = new Date(student.time);
        const targetTime = new Date(absenTime);
        targetTime.setHours(6, 45, 0, 0);
        
        const isOnTime = absenTime <= targetTime;
        const timeDiff = absenTime - targetTime;
        const diffMinutes = Math.floor(Math.abs(timeDiff) / (1000 * 60));
        
        let timeInfoHtml = '';
        if (isOnTime) {
            timeInfoHtml = `<span class="badge badge-success">Tepat Waktu</span><br><small style="color: var(--success);">-${diffMinutes} menit</small>`;
        } else {
            timeInfoHtml = `<span class="badge badge-warning">Terlambat</span><br><small style="color: var(--warning);">+${diffMinutes} menit</small>`;
        }
        
        let attributeInfoHtml = '';
        if (attributeStatus.complete) {
            attributeInfoHtml = '<span class="badge badge-success">Lengkap</span>';
        } else {
            attributeInfoHtml = `<span class="badge badge-warning">Tidak Lengkap</span><br><small style="color: var(--warning);">${missingAttributes}</small>`;
        }

        html += `
            <tr>
                <td>
                    <strong>${student.nama}</strong>
                </td>
                <td>${student.jurusan}</td>
                <td>${formatDateTime(student.time)}</td>
                <td><span class="badge badge-success">HADIR</span></td>
                <td>${timeInfoHtml}</td>
                <td>${attributeInfoHtml}</td>
            </tr>
        `;
    });

    recapTableBody.innerHTML = html;
}

function updateProgressRing(percentage) {
    const circle = document.querySelector('.ring-progress');
    const text = document.querySelector('.ring-text');
    
    if (!circle || !text) return;
    
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;
    
    circle.style.strokeDasharray = `${circumference}`;
    circle.style.strokeDashoffset = offset;
    text.textContent = `${percentage}%`;

    if (percentage >= 90) {
        circle.style.stroke = 'var(--success)';
    } else if (percentage >= 70) {
        circle.style.stroke = 'var(--warning)';
    } else {
        circle.style.stroke = 'var(--danger)';
    }
}

// ================== UTILITY FUNCTIONS ================== //

function formatShortDate(date) {
    return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short'
    });
}

function formatDate(dateTimeStr) {
    const date = new Date(dateTimeStr);
    return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function formatDateTime(dateTimeStr) {
    const date = new Date(dateTimeStr);
    return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function updateLastUpdate() {
    const now = new Date();
    const lastUpdateElement = document.getElementById('lastUpdate');
    const lastUpdateTextElement = document.getElementById('lastUpdateText');
    
    const timeStr = now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    const dateStr = now.toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    if (lastUpdateElement) lastUpdateElement.textContent = timeStr;
    if (lastUpdateTextElement) lastUpdateTextElement.textContent = `Terakhir update: ${dateStr} ${timeStr}`;
}

function showLoading() {
    const tableBody = document.getElementById('tableBody');
    if (tableBody) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="loading">
                    <div class="loading-spinner"></div>
                    Memuat data absensi...
                </td>
            </tr>
        `;
    }
}

function hideLoading() {
    const loadingElements = document.querySelectorAll('.loading');
    loadingElements.forEach(element => {
        element.style.display = 'none';
    });
}

function showError(message) {
    const tableBody = document.getElementById('tableBody');
    if (tableBody) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: var(--danger); padding: 40px;">
                    ❌ ${message}
                </td>
            </tr>
        `;
    }
}

function showMessage(message, type) {
    const existingMessage = document.querySelector('.message-popup');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message-popup ${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 10px;
        color: white;
        font-weight: bold;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    `;
    
    if (type === 'success') {
        messageDiv.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
    } else {
        messageDiv.style.background = 'linear-gradient(135deg, #ff9800, #f57c00)';
    }
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.remove();
        }
    }, 3000);
}

function printTable() {
    window.print();
}

// ⭐ PERBAIKAN: Debug function untuk monitoring
function debugAppState() {
    console.log('🔍 DEBUG APP STATE:');
    console.log('Current Filter:', currentFilter);
    console.log('Data Cache:', dataCache ? dataCache.length + ' records' : 'No cache');
    console.log('Last Data Hash:', lastDataHash);
    console.log('Is First Load:', isFirstLoad);
    console.log('Refresh Interval:', refreshInterval ? 'Active' : 'Inactive');
}

// Panggil debug function secara periodic untuk monitoring (opsional)
// setInterval(debugAppState, 60000);