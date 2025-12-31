/*
 * ALTERNATIVE IMPLEMENTATION USING PHOTOSWIPE
 * 
 * This file demonstrates how to replace the current zoom implementation
 * with PhotoSwipe for superior performance and mobile experience.
 * 
 * To use this:
 * 1. Add PhotoSwipe CSS and JS to your HTML:
 *    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.css">
 *    <script src="https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.umd.min.js"></script>
 * 
 * 2. Replace the showDocumentModal method in documents.js with the one below
 * 3. Replace setupImageZoom with setupPhotoSwipe
 */

// Add this to the DocumentsPage class
function setupPhotoSwipe() {
  // PhotoSwipe will be initialized when opening images
  console.log('PhotoSwipe zoom handler ready');
}

// Replace the showDocumentModal method with this enhanced version
function showDocumentModalWithPhotoSwipe(documentData) {
  console.log('Opening document modal with PhotoSwipe for:', documentData);
  
  const modal = document.getElementById('documentModal');
  const title = document.getElementById('documentTitle');
  const viewer = document.getElementById('documentViewer');

  if (!modal || !title || !viewer) {
    console.error('Modal elements not found');
    this.showError('Modal elements not found');
    return;
  }

  title.textContent = documentData.originalName;
  viewer.innerHTML = '';
  
  if (documentData.fileType.startsWith('image/')) {
    // For images, use PhotoSwipe for superior zoom experience
    this.setupPhotoSwipeForImage(documentData, viewer);
    this.showZoomControls(false); // PhotoSwipe has its own controls
    
  } else if (documentData.fileType === 'application/pdf') {
    // For PDFs, use the existing implementation
    this.showZoomControls(false);
    this.setupPDFViewer(documentData, viewer);
    
  } else {
    this.showZoomControls(false);
    this.setupGenericViewer(documentData, viewer);
  }

  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function setupPhotoSwipeForImage(documentData, viewer) {
  // Create a container for PhotoSwipe
  viewer.innerHTML = `
    <div class="photoswipe-container" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #000;">
      <img id="photoswipe-image" 
           src="${documentData.url}" 
           alt="${documentData.originalName}"
           style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in;"
           onclick="documentsPage.openPhotoSwipe('${documentData.url}', '${documentData.originalName}')">
    </div>
  `;
}

function openPhotoSwipe(imageUrl, imageName) {
  // Get image dimensions for PhotoSwipe
  const img = new Image();
  img.onload = () => {
    const items = [{
      src: imageUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      alt: imageName
    }];

    // PhotoSwipe options for optimal performance
    const options = {
      // Performance optimizations
      bgOpacity: 0.9,
      showHideAnimationType: 'zoom',
      
      // Mobile optimizations
      pinchToClose: true,
      closeOnVerticalDrag: true,
      
      // Zoom settings
      maxZoomLevel: 10,
      wheelToZoom: true,
      
      // UI customization
      toolbar: true,
      zoom: true,
      close: true,
      counter: false,
      
      // Callbacks for better integration
      afterInit: () => {
        console.log('PhotoSwipe initialized');
      },
      
      beforeClose: () => {
        console.log('PhotoSwipe closing');
      }
    };

    // Initialize PhotoSwipe
    const pswp = new PhotoSwipe(options);
    pswp.init();
    pswp.loadAndOpen(0, items);
  };
  
  img.src = imageUrl;
}

// Alternative: Using Panzoom library (even lighter weight)
function setupPanzoomForImage(documentData, viewer) {
  viewer.innerHTML = `
    <div class="panzoom-container" style="width: 100%; height: 100%; overflow: hidden;">
      <img id="panzoom-image" 
           src="${documentData.url}" 
           alt="${documentData.originalName}"
           style="max-width: 100%; max-height: 100%; object-fit: contain; display: block; margin: auto;">
    </div>
  `;

  // Initialize Panzoom (requires: https://cdn.jsdelivr.net/npm/@panzoom/panzoom@4.5.1/dist/panzoom.min.js)
  const image = document.getElementById('panzoom-image');
  const container = image.parentElement;
  
  // Panzoom configuration for optimal performance
  const panzoom = Panzoom(image, {
    maxScale: 10,
    minScale: 0.1,
    step: 0.1,
    
    // Performance settings
    animate: true,
    duration: 200,
    easing: 'ease-in-out',
    
    // Touch settings
    pinchAndPan: true,
    
    // Contain within parent
    contain: 'outside',
    
    // Cursor settings
    cursor: 'grab',
    
    // Event handlers
    onStart: () => {
      image.style.cursor = 'grabbing';
    },
    
    onEnd: () => {
      image.style.cursor = 'grab';
    }
  });

  // Add wheel zoom support
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    panzoom.zoomWithWheel(e);
  });

  // Add double-click to reset
  image.addEventListener('dblclick', () => {
    panzoom.reset();
  });

  // Store reference for cleanup
  this.currentPanzoom = panzoom;
}

// Alternative: Using wheel-zoom (minimal implementation)
function setupWheelZoomForImage(documentData, viewer) {
  viewer.innerHTML = `
    <div id="wheel-zoom-container" style="width: 100%; height: 100%; overflow: hidden;">
      <img id="wheel-zoom-image" 
           src="${documentData.url}" 
           alt="${documentData.originalName}"
           style="max-width: 100%; max-height: 100%; object-fit: contain; display: block; margin: auto;">
    </div>
  `;

  // Initialize wheel-zoom (requires: https://cdn.jsdelivr.net/npm/wheel-zoom@1.2.1/dist/wheel-zoom.min.js)
  const container = document.getElementById('wheel-zoom-container');
  WheelZoom(container, {
    zoom: 0.1,
    maxZoom: 10,
    speed: 100,
    
    // Performance optimizations
    smoothTime: 300,
    
    // Prepare callback for additional setup
    prepare: (scale, x, y) => {
      console.log('Wheel zoom prepared:', { scale, x, y });
    }
  });
}

/*
 * PERFORMANCE COMPARISON:
 * 
 * Current Implementation:
 * - Custom built, full control
 * - Good performance with optimizations
 * - ~5KB additional code
 * 
 * PhotoSwipe:
 * - Professional gallery solution
 * - Excellent mobile performance
 * - ~45KB but feature-rich
 * - Best for image-heavy applications
 * 
 * Panzoom:
 * - Lightweight and fast
 * - ~4KB gzipped
 * - Great balance of features/size
 * - Good for general use
 * 
 * wheel-zoom:
 * - Minimal and fast
 * - ~2KB gzipped
 * - Basic but smooth
 * - Best for simple zoom needs
 * 
 * RECOMMENDATION:
 * For your use case (document viewer), Panzoom offers the best
 * balance of performance, features, and size.
 */ 