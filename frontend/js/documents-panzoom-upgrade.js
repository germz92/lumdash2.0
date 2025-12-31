/*
 * QUICK UPGRADE TO PANZOOM - BETTER PERFORMANCE
 * 
 * This is the simplest way to get much better zoom performance.
 * Panzoom is only 4KB and provides excellent touch support.
 * 
 * STEP 1: Add Panzoom to your HTML (add this to dashboard.html):
 * <script src="https://cdn.jsdelivr.net/npm/@panzoom/panzoom@4.5.1/dist/panzoom.min.js"></script>
 * 
 * STEP 2: Replace the setupImageZoom method in documents.js with this:
 */

function setupImageZoom() {
  const image = document.getElementById('zoomableImage');
  const viewer = document.getElementById('documentViewer');
  
  if (!image || !viewer) return;
  
  // Initialize Panzoom with optimized settings
  const panzoom = Panzoom(image, {
    // Zoom settings
    maxScale: 10,
    minScale: 0.1,
    step: 0.1,
    
    // Performance optimizations
    animate: true,
    duration: 200,
    easing: 'ease-in-out',
    
    // Touch support (excellent pinch-to-zoom)
    pinchAndPan: true,
    
    // Contain image within viewer
    contain: 'outside',
    
    // Cursor feedback
    cursor: 'grab',
    
    // Event handlers for better UX
    onStart: () => {
      image.style.cursor = 'grabbing';
    },
    
    onEnd: () => {
      image.style.cursor = this.zoomLevel > 1 ? 'grab' : 'default';
    },
    
    // Update zoom level display
    onZoom: (e) => {
      this.zoomLevel = e.detail.scale;
      this.updateZoomDisplay();
      
      // Update UI state
      if (this.zoomLevel > 1) {
        viewer.classList.add('zoomed');
      } else {
        viewer.classList.remove('zoomed');
      }
    }
  });

  // Add wheel zoom support (smooth scroll zoom)
  viewer.addEventListener('wheel', (e) => {
    e.preventDefault();
    panzoom.zoomWithWheel(e);
  });

  // Button controls
  const zoomIn = document.getElementById('zoomIn');
  const zoomOut = document.getElementById('zoomOut');
  const resetZoom = document.getElementById('resetZoom');
  
  if (zoomIn) {
    zoomIn.addEventListener('click', () => {
      panzoom.zoomIn();
    });
  }
  
  if (zoomOut) {
    zoomOut.addEventListener('click', () => {
      panzoom.zoomOut();
    });
  }
  
  if (resetZoom) {
    resetZoom.addEventListener('click', () => {
      panzoom.reset();
    });
  }

  // Double-click to reset (common UX pattern)
  image.addEventListener('dblclick', () => {
    panzoom.reset();
  });

  // Store reference for cleanup
  this.currentPanzoom = panzoom;
  
  // Show zoom controls
  this.showZoomControls(true);
}

/*
 * STEP 3: Update the closeModal method to clean up Panzoom:
 */

function closeModal() {
  const modal = document.getElementById('documentModal');
  const viewer = document.getElementById('documentViewer');
  
  // Clean up Panzoom instance
  if (this.currentPanzoom) {
    this.currentPanzoom.destroy();
    this.currentPanzoom = null;
  }
  
  // Reset zoom state
  this.zoomLevel = 1;
  this.imagePosition = { x: 0, y: 0 };
  this.isDragging = false;
  
  // Hide zoom controls
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

/*
 * STEP 4: Add this CSS to documents.html for better Panzoom styling:
 */

const additionalCSS = `
<style>
/* Panzoom optimizations */
.document-viewer img {
  /* Remove our custom transform handling */
  transform: none !important;
  will-change: auto;
  
  /* Let Panzoom handle the cursor */
  cursor: grab;
}

.document-viewer img:active {
  cursor: grabbing;
}

/* Smooth transitions for Panzoom */
.panzoom-element {
  transition: transform 0.2s ease-out;
}

/* Prevent text selection during pan */
.document-viewer.zoomed {
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}
</style>
`;

/*
 * BENEFITS OF THIS UPGRADE:
 * 
 * ✅ Much smoother pinch-to-zoom on mobile
 * ✅ Better scroll wheel zoom performance  
 * ✅ Hardware-accelerated transforms
 * ✅ Momentum and inertia built-in
 * ✅ Better touch event handling
 * ✅ Only 4KB additional size
 * ✅ Actively maintained library
 * ✅ Works on all modern browsers
 * 
 * The upgrade is minimal but provides significantly better UX,
 * especially on mobile devices with touch screens.
 */ 