// IMMEDIATE DEBUG: Check if script is executing
console.log('🔥 documents.js STARTING TO EXECUTE');
console.log('🔥 Current timestamp:', new Date().toISOString());

// Set a marker to confirm script execution
window.__documentsJsLoaded = true;

// Check for any potential blocking issues
try {
  console.log('🔥 API_BASE available:', typeof API_BASE !== 'undefined' ? API_BASE : 'UNDEFINED');
  console.log('🔥 window.API_BASE available:', typeof window.API_BASE !== 'undefined' ? window.API_BASE : 'UNDEFINED');
  console.log('🔥 localStorage available:', typeof localStorage !== 'undefined');
  
  // Ensure API_BASE is available globally
  if (typeof API_BASE === 'undefined' && typeof window.API_BASE !== 'undefined') {
    window.API_BASE = window.API_BASE;
    console.log('🔥 Set API_BASE from window.API_BASE');
  }
  
  if (typeof API_BASE === 'undefined' && typeof window.API_BASE === 'undefined') {
    console.error('🔥 CRITICAL: API_BASE is not available!');
    // Set a fallback
    window.API_BASE = 'http://localhost:3000';
    console.log('🔥 Set fallback API_BASE');
  }
  
} catch (e) {
  console.error('🔥 Error checking dependencies:', e);
}

// Clear any existing initPage function to prevent conflicts with other pages
// window.initPage = null; // Removed - this was interfering with function definition

try {
  console.log('🔥 Starting class and function definitions...');

class PhotoSwipeImageViewer {
  constructor() {
    this.pswp = null;
  }

  async openImage(doc) {
    console.log('[PhotoSwipeViewer.openImage] Called with:', doc);
    
    if (typeof window.PhotoSwipe !== 'function') {
      console.error('[PhotoSwipeViewer.openImage] window.PhotoSwipe is not a function! Cannot initialize. Type:', typeof window.PhotoSwipe);
      this.fallbackToNewTab(doc);
      return;
    }
    console.log('[PhotoSwipeViewer.openImage] PhotoSwipe constructor is available.');

    let imageDimensions = { w: 0, h: 0 };
    try {
      console.log('[PhotoSwipeViewer.openImage] Preloading image to get dimensions:', doc.url);
      imageDimensions = await this.getImageDimensions(doc.url);
      console.log('[PhotoSwipeViewer.openImage] Actual image dimensions determined:', imageDimensions);
    } catch (error) {
      console.warn('[PhotoSwipeViewer.openImage] Could not preload image dimensions, PhotoSwipe will attempt to determine them automatically. Error:', error);
      // If preloading fails, PhotoSwipe will still try to load with w:0, h:0
    }

    const imageData = [{
      src: doc.url,
      msrc: doc.url, 
      w: imageDimensions.w, // Use determined width
      h: imageDimensions.h, // Use determined height
      alt: doc.filename,
      title: doc.filename 
    }];

    console.log('[PhotoSwipeViewer.openImage] Image data for PhotoSwipe:', imageData);

    const options = {
      dataSource: imageData,
      index: 0,
      showHideAnimationType: 'zoom',
      bgOpacity: 0.9,
      maxZoomLevel: 5,
      initialZoomLevel: 'fit',
      secondaryZoomLevel: 2,
      zoomAnimationDuration: 300,
      pinchToClose: true,
      closeOnVerticalDrag: true,
      preload: [1, 1],
      closeSVG: '<svg class="pswp__svg" viewBox="0 0 32 32" aria-hidden="true"><path d="M24 8 8 24M8 8l16 16"/></svg>',
      zoomSVG: '<svg class="pswp__svg" viewBox="0 0 32 32" aria-hidden="true"><path d="m23.5 22-5.7-5.7M15 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 15A7 7 0 1 1 22 15 7 7 0 0 1 8 15Z"/></svg>',
      arrowPrevSVG: '<svg class="pswp__svg" viewBox="0 0 32 32" aria-hidden="true"><path d="M20 26 10 16l10-10"/></svg>',
      arrowNextSVG: '<svg class="pswp__svg" viewBox="0 0 32 32" aria-hidden="true"><path d="m12 6 10 10-10 10"/></svg>',
      paddingFn: () => ({ top: 20, bottom: 20, left: 20, right: 20 })
    };

    console.log('[PhotoSwipeViewer.openImage] PhotoSwipe options prepared:', options);

    try {
      console.log('[PhotoSwipeViewer.openImage] Attempting to create new PhotoSwipe instance...');
      this.pswp = new window.PhotoSwipe(options);
      console.log('[PhotoSwipeViewer.openImage] PhotoSwipe instance successfully created.');
      
      this.pswp.on('uiRegister', () => {
        console.log('[PhotoSwipeViewer.openImage] uiRegister event');
        this.pswp.ui.registerElement({
          name: 'download', order: 8, isButton: true, title: 'Download',
          html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
          onClick: (event, el) => {
            const link = document.createElement('a');
            link.href = this.pswp.currSlide.data.src;
            link.download = this.pswp.currSlide.data.alt || 'image';
            link.click();
          }
        });
        this.pswp.ui.registerElement({
          name: 'external', order: 9, isButton: true, title: 'Open in new tab',
          html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>',
          onClick: () => { window.open(this.pswp.currSlide.data.src, '_blank'); }
        });
      });

      this.pswp.on('close', () => {
        console.log('[PhotoSwipeViewer.openImage] Instance closed.');
        this.pswp = null;
      });

      console.log('[PhotoSwipeViewer.openImage] Initializing PhotoSwipe lightbox...');
      this.pswp.init();
      console.log('[PhotoSwipeViewer.openImage] Lightbox initialized and opened.');
      
    } catch (error) {
      console.error('[PhotoSwipeViewer.openImage] Critical error initializing PhotoSwipe instance:', error);
      this.fallbackToNewTab(doc);
    }
  }

  async getImageDimensions(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = (err) => {
        console.error('[PhotoSwipeViewer.getImageDimensions] Error loading image for dimension check:', url, err);
        reject(err);
      };
      img.src = url;
    });
  }

  fallbackToNewTab(doc) {
    console.warn('PhotoSwipe failed, falling back to opening image in a new tab.');
    window.open(doc.url, '_blank');
  }

  close() {
    if (this.pswp) {
      this.pswp.close();
    }
  }
}

class DocumentsPage {
  constructor() {
    this.documents = [];
    this.currentTable = null;
    this.isOwner = false;
    this.cloudinaryWidget = null;
    this.currentDocument = null;
    this.eventId = localStorage.getItem('eventId');
    this.photoSwipeViewer = null; // Add PhotoSwipe viewer
  }

  async init() {
    console.log('🔥 DocumentsPage.init() called');
    
    // Load Cloudinary script if not already loaded
    if (!window.cloudinary) {
      await this.loadCloudinaryScript();
    }
    
    await this.checkOwnerStatus();
    await this.loadDocuments();
    this.setupEventListeners();
    this.updateUIForOwnerStatus();
  }

  async loadCloudinaryScript() {
    return new Promise((resolve, reject) => {
      if (window.cloudinary) {
        resolve();
        return;
      }
      
      const script = document.createElement('script');
      script.src = 'https://media-library.cloudinary.com/global/all.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async loadPhotoSwipe() {
    // Load CSS
    if (!document.querySelector('link[href*="photoswipe"]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/photoswipe/5.4.4/photoswipe.min.css';
      document.head.appendChild(css);
      console.log('PhotoSwipe CSS loaded');
    }

    // Load JS
    if (!window.PhotoSwipe) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/photoswipe/5.4.4/umd/photoswipe.umd.min.js';
        script.onload = () => {
          console.log('PhotoSwipe JS loaded successfully');
          console.log('PhotoSwipe available:', typeof window.PhotoSwipe);
          resolve();
        };
        script.onerror = (error) => {
          console.error('Failed to load PhotoSwipe:', error);
          reject(error);
        };
        document.head.appendChild(script);
      });
    }
  }

  async checkOwnerStatus() {
    try {
      const token = localStorage.getItem('token');
      const userId = localStorage.getItem('userId');
      
      if (!token || !userId) {
        console.log('No token or userId found');
        this.isOwner = false;
        return;
      }

      const apiBase = window.API_BASE || API_BASE || 'http://localhost:3000';
      const response = await fetch(`${apiBase}/api/tables/${this.eventId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.error('Failed to fetch table data for owner check');
        this.isOwner = false;
        return;
      }

      const table = await response.json();
      this.isOwner = Array.isArray(table.owners) && table.owners.includes(userId);
      
      console.log('Owner status checked:', {
        userId,
        tableOwners: table.owners,
        isOwner: this.isOwner
      });

      // Update UI based on owner status
      this.updateUIForOwnerStatus();
      
    } catch (error) {
      console.error('Error checking owner status:', error);
      this.isOwner = false;
    }
  }

  updateUIForOwnerStatus() {
    const uploadSection = document.querySelector('.upload-section');
    const uploadNewButton = document.querySelector('.btn-upload-new');
    
    if (!this.isOwner) {
      // Hide upload section for non-owners
      if (uploadSection) {
        uploadSection.style.display = 'none';
      }
      
      // Hide upload new button for non-owners
      if (uploadNewButton) {
        uploadNewButton.style.display = 'none';
      }
    } else {
      // Show upload section for owners
      if (uploadSection) {
        uploadSection.style.display = 'block';
      }
      
      // Show upload new button for owners
      if (uploadNewButton) {
        uploadNewButton.style.display = 'block';
      }
    }
  }

  setupEventListeners() {
    // Upload area events
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    if (!uploadArea || !fileInput) {
      console.error('Upload area or file input not found!');
      return;
    }

    // Handle click events for both desktop and mobile
    const handleUploadAreaClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Check if user is owner before allowing file selection
      if (!this.isOwner) {
        this.showError('Only event owners can upload maps');
        return;
      }
      
      console.log('Upload area clicked, triggering file input');
      fileInput.click();
    };

    // Add both click and touchend events for better mobile support
    uploadArea.addEventListener('click', handleUploadAreaClick);
    uploadArea.addEventListener('touchend', (e) => {
      e.preventDefault();
      handleUploadAreaClick(e);
    });

    // Drag and drop events
    uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
    uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
    uploadArea.addEventListener('drop', this.handleDrop.bind(this));

    // File input change event
    fileInput.addEventListener('change', (e) => {
      console.log('File input changed, files:', e.target.files.length);
      if (e.target.files.length > 0) {
        this.uploadFile(e.target.files[0]);
      }
    });

    // Modal events
    const closeModal = document.getElementById('closeModal');
    const modalOverlay = document.getElementById('modalOverlay');

    if (closeModal) closeModal.addEventListener('click', this.closeModal.bind(this));
    if (modalOverlay) modalOverlay.addEventListener('click', this.closeModal.bind(this));

    // Keyboard events
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('documentModal').style.display !== 'none') {
        if (e.key === 'Escape') this.closeModal();
      }
    });
  }

  handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
  }

  handleDragLeave(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
  }

  handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    
    // Check if user is owner before allowing file drops
    if (!this.isOwner) {
      this.showError('Only event owners can upload maps');
      return;
    }
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      this.uploadFile(files[0]);
    }
  }

  async uploadFile(file) {
    // Check if user is owner before allowing upload
    if (!this.isOwner) {
      this.showError('Only event owners can upload maps');
      return;
    }

    // Validate file
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    
    console.log('Uploading file:', file.name, 'Type:', file.type, 'Size:', file.size);
    
    if (file.size > maxSize) {
      this.showError('File size must be less than 10MB');
      return;
    }

    if (!allowedTypes.includes(file.type)) {
      this.showError('Only PDF, JPG, and PNG files are allowed');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('eventId', this.eventId);

    this.showUploadProgress();

    try {
      const token = localStorage.getItem('token');
      console.log('Upload token exists:', token ? 'YES' : 'NO');
      
      const apiBase = window.API_BASE || API_BASE || 'http://localhost:3000';
      const response = await fetch(`${apiBase}/api/tables/${this.eventId}/documents`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      console.log('Upload response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.log('Upload error response:', errorText);
        throw new Error(`Upload failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      console.log('Upload successful:', result);
      this.hideUploadProgress();
      this.showSuccess('Map uploaded successfully');
      this.loadDocuments();
      
      // Reset file input
      document.getElementById('fileInput').value = '';
      
    } catch (error) {
      console.error('Upload error:', error);
      this.hideUploadProgress();
      this.showError('Failed to upload map: ' + error.message);
    }
  }

  showUploadProgress() {
    document.getElementById('uploadProgress').style.display = 'block';
    // Simulate progress for now - in a real implementation, you'd track actual progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      document.getElementById('progressFill').style.width = progress + '%';
      if (progress >= 90) {
        clearInterval(interval);
      }
    }, 100);
  }

  hideUploadProgress() {
    document.getElementById('uploadProgress').style.display = 'none';
    document.getElementById('progressFill').style.width = '0%';
  }

  async loadDocuments() {
    console.log('Loading documents with token:', localStorage.getItem('token') ? 'EXISTS' : 'MISSING');
    console.log('EventId:', this.eventId);
    console.log('API_BASE:', window.API_BASE || API_BASE);
    
    // Add debugging for timing
    console.log('loadDocuments called at:', new Date().toISOString());
    
    try {
      const apiBase = window.API_BASE || API_BASE || 'http://localhost:3000';
      const response = await fetch(`${apiBase}/api/tables/${this.eventId}/documents`, {
        headers: {
          'Authorization': localStorage.getItem('token')
        }
      });
      
      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const documents = await response.json();
      console.log('Loaded documents:', documents.length);
      console.log('Documents data:', documents);
      
      this.renderDocuments(documents);
      
      // Update UI for owner status after rendering documents
      // This ensures all UI elements exist before we try to modify them
      this.updateUIForOwnerStatus();
      
    } catch (error) {
      console.error('Error loading documents:', error);
      this.showError('Failed to load documents: ' + error.message);
    }
  }

  renderDocuments(documents) {
    const uploadSection = document.querySelector('.upload-section');
    const grid = document.getElementById('documentsGrid');
    
    if (documents.length === 0) {
      // Show upload area when no documents, but only for owners
      if (this.isOwner) {
        uploadSection.style.display = 'block';
        grid.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <span class="material-symbols-outlined">map</span>
            <h3>No maps yet</h3>
            <p>Upload your first map to get started</p>
          </div>
        `;
      } else {
        uploadSection.style.display = 'none';
        grid.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <span class="material-symbols-outlined">map</span>
            <h3>No maps available</h3>
            <p>No maps have been uploaded for this event yet</p>
          </div>
        `;
      }
      return;
    }

    // Hide upload area when documents exist (will be shown via button for owners)
    uploadSection.style.display = 'none';

    // Show documents prominently with conditional remove button
    grid.innerHTML = documents.map(doc => `
      <div class="document-card-prominent">
        <div class="document-preview-large">
          ${this.getDocumentPreview(doc, true)}
        </div>
        <div class="document-info-prominent">
          <h2 class="document-title-large">${doc.originalName}</h2>
          <div class="document-meta-prominent">
            <span>Uploaded: ${this.formatDate(doc.uploadedAt)}</span>
            <span class="document-size">${this.formatFileSize(doc.size)}</span>
          </div>
          <div class="document-actions">
            <button class="btn-primary" onclick="documentsPage.openDocument('${doc._id}')">
              <span class="material-symbols-outlined">open_in_full</span>
              View Full Screen
            </button>
          </div>
        </div>
        ${this.isOwner ? `
          <button class="remove-file-btn" onclick="documentsPage.deleteDocumentDirect('${doc._id}')" title="Remove file">
            <span class="material-symbols-outlined">close</span>
          </button>
        ` : ''}
      </div>
    `).join('');

    // Add upload new file button at the bottom, but only for owners
    if (this.isOwner) {
      grid.innerHTML += `
        <div class="upload-new-section">
          <button class="btn-upload-new" onclick="documentsPage.showUploadArea()">
            <span class="material-symbols-outlined">add</span>
            Upload Another Map
          </button>
        </div>
      `;
    }
  }

  getDocumentPreview(doc, isLarge = false) {
    const sizeClass = isLarge ? 'large' : '';
    
    if (doc.fileType.startsWith('image/')) {
      return `<img src="${doc.url}" alt="${doc.originalName}" loading="lazy" class="preview-image ${sizeClass}">`;
    } else if (doc.fileType === 'application/pdf') {
      // For PDF preview, show first page as image using PDF.js or embed
      return `
        <div class="pdf-preview ${sizeClass}">
          <embed src="${doc.url}#toolbar=0&navpanes=0&scrollbar=0" type="application/pdf" class="pdf-embed ${sizeClass}">
          <div class="pdf-fallback">
            <span class="material-symbols-outlined file-icon">picture_as_pdf</span>
            <p>PDF Document</p>
          </div>
        </div>
      `;
    } else {
      return `<span class="material-symbols-outlined file-icon ${sizeClass}">description</span>`;
    }
  }

  async openDocument(documentId) {
    console.log('Opening document with ID:', documentId);
    console.log('Event ID:', this.eventId);
    const apiBase = window.API_BASE || API_BASE || 'http://localhost:3000';
    console.log('API_BASE:', apiBase);
    
    try {
      const token = localStorage.getItem('token');
      console.log('Token exists:', token ? 'YES' : 'NO');
      
      const url = `${apiBase}/api/tables/${this.eventId}/documents/${documentId}`;
      console.log('Fetching document from URL:', url);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', errorText);
        throw new Error(`Failed to load document: ${response.status} ${errorText}`);
      }

      const documentData = await response.json();
      console.log('Document data received:', documentData);
      
      if (!documentData || !documentData.url) {
        console.error('Invalid document data:', documentData);
        throw new Error('Invalid document data received');
      }
      
      this.currentDocument = documentData;
      this.showDocumentModal(documentData);
      
    } catch (error) {
      console.error('Open document error:', error);
      this.showError('Failed to open map: ' + error.message);
    }
  }

  showDocumentModal(documentData) {
    console.log('[showDocumentModal] Opening document modal with data:', documentData);
    console.log('[showDocumentModal] Type of documentData:', typeof documentData);
    console.log('[showDocumentModal] documentData.fileType:', documentData ? documentData.fileType : 'documentData is null/undefined');
    console.log('[showDocumentModal] documentData.url:', documentData ? documentData.url : 'documentData is null/undefined');

    const modal = document.getElementById('documentModal');
    const title = document.getElementById('documentTitle');
    const viewer = document.getElementById('documentViewer');

    if (!modal || !title || !viewer) {
      console.error('Modal elements not found:', { modal: !!modal, title: !!title, viewer: !!viewer });
      this.showError('Modal elements not found');
      return;
    }

    title.textContent = documentData.originalName;
    
    // Clear previous content
    viewer.innerHTML = '';
    viewer.classList.remove('zoomed');
    
    console.log('Document type:', documentData.fileType);
    console.log('Document URL:', documentData.url);
    
    if (documentData.fileType.startsWith('image/')) {
      console.log('Image detected, using PhotoSwipe...');
      
      // Close the modal since PhotoSwipe will handle the display
      modal.style.display = 'none';
      document.body.style.overflow = '';
      
      // Use PhotoSwipe for native image viewing
      const docForViewer = {
        url: documentData.url,
        filename: documentData.originalName,
        type: 'image'
      };
      
      // Try PhotoSwipe with fallback to new tab
      this.openImageWithNativeViewer(docForViewer);
      return;
    } else if (documentData.fileType === 'application/pdf') {
      console.log('Displaying PDF');
      // Hide zoom controls for PDFs
      this.showZoomControls(false);
      
      // Use direct URL since backend handles inline viewing configuration
      const pdfUrl = documentData.url;
      
      viewer.innerHTML = `
        <div style="width: 100%; height: 100%; position: relative; background: #f0f0f0;">
          <!-- Primary: Object tag with inline PDF -->
          <object id="pdfObject" 
                  data="${pdfUrl}#toolbar=1&navpanes=1&scrollbar=1&view=FitH&pagemode=none" 
                  type="application/pdf" 
                  style="width: 100%; height: 100%; border: none; display: block;"
                  onload="console.log('PDF object loaded'); document.getElementById('pdfLoading').style.display='none';"
                  onerror="this.style.display='none'; document.getElementById('pdfFallback').style.display='block'; document.getElementById('pdfLoading').style.display='none';">
            <p>Your browser doesn't support PDF viewing.</p>
          </object>
          
          <!-- Fallback 1: PDF.js viewer -->
          <div id="pdfFallback" style="display: none; width: 100%; height: 100%;">
            <iframe src="https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(pdfUrl)}" 
                    style="width: 100%; height: 100%; border: none;"
                    onload="console.log('PDF.js viewer loaded')"
                    onerror="this.style.display='none'; document.getElementById('pdfFallback2').style.display='block';">
            </iframe>
          </div>
          
          <!-- Fallback 2: Convert to image option -->
          <div id="pdfFallback2" style="display: none; text-align: center; padding: 40px; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center;">
            <span class="material-symbols-outlined" style="font-size: 64px; color: #666; margin-bottom: 16px;">picture_as_pdf</span>
            <h3>PDF Preview Not Available</h3>
            <p>Your browser doesn't support PDF viewing. Convert to image for better viewing.</p>
            <div style="margin-top: 20px;">
              <button onclick="documentsPage.convertPdfToImage('${documentData._id}')" 
                      class="btn-primary" style="display: inline-flex; align-items: center; gap: 8px; margin: 8px;">
                <span class="material-symbols-outlined">image</span>
                Convert to Image
              </button>
            </div>
          </div>
          
          <!-- Loading indicator -->
          <div id="pdfLoading" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; z-index: 10; background: rgba(255,255,255,0.9); padding: 20px; border-radius: 8px;">
            <div style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; margin: 0 auto 16px;"></div>
            <p>Loading PDF...</p>
          </div>
        </div>
        
        <style>
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      `;
      
      // Hide loading after a delay if PDF doesn't load
      setTimeout(() => {
        const loading = document.getElementById('pdfLoading');
        if (loading && loading.style.display !== 'none') {
          loading.style.display = 'none';
          // If PDF object failed to load, show fallback
          const pdfObject = document.getElementById('pdfObject');
          if (pdfObject && pdfObject.style.display !== 'none') {
            pdfObject.style.display = 'none';
            document.getElementById('pdfFallback').style.display = 'block';
          }
        }
      }, 5000);
      
    } else {
      console.log('Unknown file type, showing generic view');
      // Hide zoom controls for other file types
      this.showZoomControls(false);
      
      viewer.innerHTML = `
        <div style="text-align: center; padding: 40px;">
          <span class="material-symbols-outlined" style="font-size: 64px; color: #666; display: block; margin-bottom: 16px;">description</span>
          <h3>Document Preview Not Available</h3>
          <p>File type: ${documentData.fileType}</p>
        </div>
      `;
    }

    // Show modal with proper display
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    console.log('Modal should now be visible');
    
    // Add a small delay to ensure modal is rendered
    setTimeout(() => {
      const modalRect = modal.getBoundingClientRect();
      console.log('Modal dimensions:', modalRect);
      const viewerRect = viewer.getBoundingClientRect();
      console.log('Viewer dimensions:', viewerRect);
    }, 100);
  }

  closeModal() {
    const modal = document.getElementById('documentModal');
    const viewer = document.getElementById('documentViewer');
    
    // Hide zoom controls (no longer needed with PhotoSwipe)
    this.showZoomControls(false);
    
    // Remove zoomed class
    if (viewer) {
      viewer.classList.remove('zoomed');
    }
    
    // Hide modal
    modal.style.display = 'none';
    document.body.style.overflow = '';
    this.currentDocument = null;
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  showError(message) {
    // You can implement a toast notification system here
    alert('Error: ' + message);
  }

  showSuccess(message) {
    // You can implement a toast notification system here
    alert('Success: ' + message);
  }

  showUploadArea() {
    // Check if user is owner before showing upload area
    if (!this.isOwner) {
      this.showError('Only event owners can upload maps');
      return;
    }
    
    const uploadSection = document.querySelector('.upload-section');
    uploadSection.style.display = 'block';
    uploadSection.scrollIntoView({ behavior: 'smooth' });
  }

  async deleteDocumentDirect(documentId) {
    // Check if user is owner before allowing delete
    if (!this.isOwner) {
      this.showError('Only event owners can remove maps');
      return;
    }
    
    if (!confirm('Are you sure you want to remove this map?')) return;

    try {
      const apiBase = window.API_BASE || API_BASE || 'http://localhost:3000';
      const response = await fetch(`${apiBase}/api/tables/${this.eventId}/documents/${documentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to delete document');
      }

      this.showSuccess('Map removed successfully');
      this.loadDocuments();
      
    } catch (error) {
      console.error('Delete document error:', error);
      this.showError('Failed to remove map');
    }
  }

  async convertPdfToImage(documentId) {
    if (!this.isOwner) {
      this.showError('Only event owners can convert PDFs');
      return;
    }

    try {
      const apiBase = window.API_BASE || API_BASE || 'http://localhost:3000';
      const response = await fetch(`${apiBase}/api/documents/${documentId}/convert`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to convert PDF');
      }

      const result = await response.json();
      this.showSuccess('PDF converted to image successfully');
      
      // Reload documents to show the new image
      await this.loadDocuments();
      
      return result;
    } catch (error) {
      console.error('Error converting PDF:', error);
      this.showError('Failed to convert PDF to image');
      throw error;
    }
  }

  showZoomControls(show) {
    // Zoom controls are no longer needed with PhotoSwipe
    // This method is kept for compatibility but does nothing
  }

  openImageWithCloudinary(doc) {
    // Initialize Cloudinary Media Library Widget for viewing
    this.cloudinaryWidget = window.cloudinary.createMediaLibrary({
      cloud_name: 'your_cloud_name', // You'll need to replace this with your actual cloud name
      api_key: 'your_api_key', // You'll need to replace this with your actual API key
      multiple: false,
      max_files: 1,
      insert_caption: "View Image",
      default_transformations: [[]],
      inline_container: "#cloudinary-widget-container",
      folder: {
        path: "documents",
        resource_type: "image"
      },
      search: {
        query: `public_id:${doc.cloudinary_public_id || doc.filename.split('.')[0]}`
      }
    }, {
      insertHandler: function(data) {
        // This won't be called since we're just viewing
        console.log('Image selected:', data);
      }
    });

    // Create modal for Cloudinary widget
    const modal = document.createElement('div');
    modal.className = 'document-modal';
    modal.innerHTML = `
      <div class="modal-content cloudinary-modal">
        <div class="modal-header">
          <h3>${doc.filename}</h3>
          <button class="close-modal">&times;</button>
        </div>
        <div id="cloudinary-widget-container" style="width: 100%; height: 80vh;"></div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close modal functionality
    const closeBtn = modal.querySelector('.close-modal');
    closeBtn.addEventListener('click', () => {
      if (this.cloudinaryWidget) {
        this.cloudinaryWidget.destroy();
        this.cloudinaryWidget = null;
      }
      document.body.removeChild(modal);
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeBtn.click();
      }
    });

    // Show the widget
    this.cloudinaryWidget.show();
  }

  // PhotoSwipe-powered native image viewer
  async openImageWithNativeViewer(doc) {
    console.log('openImageWithNativeViewer called with:', doc);
    
    try {
      // Ensure PhotoSwipe is loaded before creating the viewer instance
      if (!window.PhotoSwipe) {
        console.log('PhotoSwipe not found, loading now...');
        await this.loadPhotoSwipe(); // Wait for the script to load
        console.log('PhotoSwipe JS should be loaded now. Checking window.PhotoSwipe:', window.PhotoSwipe);
      }

      // Double-check if PhotoSwipe is now available
      if (!window.PhotoSwipe) {
        console.error('PhotoSwipe failed to load after explicit attempt. Falling back.');
        this.openImageInNewTab(doc);
        return;
      }

      // Create and use the viewer instance only if it doesn't exist or PhotoSwipe was just loaded
      if (!this.photoSwipeViewer) {
        console.log('Creating new PhotoSwipeImageViewer instance.');
        this.photoSwipeViewer = new PhotoSwipeImageViewer();
      }
      
      console.log('Opening image with PhotoSwipe viewer...');
      await this.photoSwipeViewer.openImage(doc); // This calls the openImage method of the instance
      
    } catch (error) {
      console.error('Error in openImageWithNativeViewer:', error);
      // Fallback to opening in new tab
      console.log('Falling back to new tab due to error:', error.message);
      this.openImageInNewTab(doc);
    }
  }

  // Legacy openDocument method - RENAME TO AVOID CONFLICT
  // The main openDocument method above handles API calls and uses PhotoSwipe for images
  _legacy_openDocument_object(doc) { // Renamed
    console.log('[Legacy Method] Opening document object:', doc);
    
    if (doc && doc.type === 'image') {
      console.log('[Legacy Method] Document is image, using PhotoSwipe via openImageWithNativeViewer');
      this.openImageWithNativeViewer(doc);
    } else if (doc && doc.url) { // Check if it might be a PDF object
      console.log('[Legacy Method] Document is not image or structure unclear, trying PDF modal');
      this.openPDFDocument(doc);
    } else {
      console.error('[Legacy Method] Called with invalid document object:', doc);
      this.showError('Cannot open this document type or data is invalid.');
    }
  }

  openPDFDocument(doc) {
    const modal = document.createElement('div');
    modal.className = 'document-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>${doc.filename}</h3>
          <div class="pdf-actions">
            <button class="open-native-btn">Open in New Tab</button>
            <button class="close-modal">&times;</button>
          </div>
        </div>
        <div class="pdf-container">
          <embed src="${doc.url}#toolbar=1&navpanes=1&scrollbar=1" type="application/pdf" style="width: 100%; height: 80vh;">
          <p style="text-align: center; margin-top: 10px; color: #666;">
            If the PDF doesn't display, click "Open in New Tab" above
          </p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Open in new tab functionality
    const openNativeBtn = modal.querySelector('.open-native-btn');
    openNativeBtn.addEventListener('click', () => {
      window.open(doc.url, '_blank');
    });

    // Close modal functionality
    const closeBtn = modal.querySelector('.close-modal');
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeBtn.click();
      }
    });
  }

  // Simple fallback image viewer that opens in new tab
  openImageInNewTab(doc) {
    console.log('Opening image in new tab:', doc.url);
    window.open(doc.url, '_blank');
  }
}

// Global variable to hold the documents page instance
let documentsPage;

// IMMEDIATE DEBUG: About to define initPage function
console.log('🔥 About to define initPage function');

// Initialize function called by app.js
function initPage(eventId) {
  console.log('Documents page initPage called with eventId:', eventId);
  
  // Add debugging for timing and state
  console.log('initPage called at:', new Date().toISOString());
  console.log('DOM ready state:', document.readyState);
  console.log('Window loaded:', document.readyState === 'complete');
  
  // Store the eventId in localStorage for consistency
  if (eventId) {
    localStorage.setItem('eventId', eventId);
  }
  
  // Ensure DOM is ready before initializing
  const initialize = () => {
    console.log('Initializing documents page...');
    
    // Check if required elements exist
    const uploadArea = document.getElementById('uploadArea');
    const documentsGrid = document.getElementById('documentsGrid');
    
    console.log('Upload area exists:', !!uploadArea);
    console.log('Documents grid exists:', !!documentsGrid);
    
    if (!uploadArea || !documentsGrid) {
      console.error('Required DOM elements not found, retrying in 100ms...');
      setTimeout(initialize, 100);
      return;
    }
    
    // Initialize the documents page (use global variable, don't redeclare)
    documentsPage = new DocumentsPage();
    documentsPage.init();
    
    // Make it globally available for debugging
    window.documentsPage = documentsPage;
    
    console.log('Documents page initialized successfully');
  };
  
  // Initialize immediately if DOM is ready, otherwise wait
  if (document.readyState === 'loading') {
    console.log('DOM still loading, waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    console.log('DOM ready, initializing immediately...');
    initialize();
  }
}

// Ensure this page's initPage function is the only one available
window.initPage = initPage;

// Add debugging to confirm the function is properly defined
console.log('documents.js loaded, window.initPage defined:', typeof window.initPage === 'function');
console.log('documents.js initPage function:', window.initPage);
} catch (error) {
  console.error('🔥 CRITICAL ERROR in documents.js:', error);
  console.error('🔥 Error stack:', error.stack);
} 