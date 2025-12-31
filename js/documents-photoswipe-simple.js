/**
 * SIMPLE PHOTOSWIPE IMPLEMENTATION FOR NATIVE IMAGE VIEWING
 * 
 * This provides a professional, native-feeling image viewer that:
 * - Feels like viewing images natively on mobile/desktop
 * - Smooth pinch-to-zoom without jumping or quality loss
 * - Hardware-accelerated performance
 * - Professional mobile UX patterns
 * 
 * To use this, replace the openImageWithNativeViewer method in documents.js
 */

class PhotoSwipeImageViewer {
    constructor() {
        this.pswp = null;
        this.loadPhotoSwipe();
    }

    async loadPhotoSwipe() {
        // Load PhotoSwipe CSS and JS
        if (!document.querySelector('link[href*="photoswipe"]')) {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = 'https://cdn.jsdelivr.net/npm/photoswipe@5.4.2/dist/photoswipe.css';
            document.head.appendChild(css);
        }

        if (!window.PhotoSwipe) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/photoswipe@5.4.2/dist/photoswipe.esm.min.js';
            script.type = 'module';
            
            return new Promise((resolve) => {
                script.onload = () => {
                    // PhotoSwipe is loaded as ES module, need to import it
                    import('https://cdn.jsdelivr.net/npm/photoswipe@5.4.2/dist/photoswipe.esm.min.js')
                        .then(module => {
                            window.PhotoSwipe = module.default;
                            resolve();
                        });
                };
                document.head.appendChild(script);
            });
        }
    }

    async openImage(doc) {
        await this.loadPhotoSwipe();

        // Create image data for PhotoSwipe
        const imageData = [{
            src: doc.url,
            width: 0, // Will be determined automatically
            height: 0, // Will be determined automatically
            alt: doc.filename
        }];

        // PhotoSwipe options for native-feeling experience
        const options = {
            // Core settings
            dataSource: imageData,
            index: 0,
            
            // UI settings for native feel
            showHideAnimationType: 'zoom',
            bgOpacity: 0.9,
            spacing: 0.1,
            allowPanToNext: false,
            
            // Zoom settings for smooth experience
            maxZoomLevel: 5,
            initialZoomLevel: 'fit',
            secondaryZoomLevel: 2,
            zoomAnimationDuration: 300,
            
            // Mobile optimizations
            pinchToClose: true,
            closeOnVerticalDrag: true,
            
            // Performance optimizations
            preload: [1, 1],
            
            // Custom UI elements
            toolbar: [
                'zoom',
                'close'
            ],
            
            // Disable features that might interfere with native feel
            loop: false,
            counter: false,
            arrowKeys: false,
            
            // Custom styling
            paddingFn: (viewportSize) => {
                return {
                    top: 20,
                    bottom: 20,
                    left: 20,
                    right: 20
                };
            }
        };

        // Initialize PhotoSwipe
        this.pswp = new window.PhotoSwipe(options);
        
        // Add custom event listeners for better UX
        this.pswp.on('uiRegister', () => {
            // Add download button
            this.pswp.ui.registerElement({
                name: 'download',
                order: 8,
                isButton: true,
                html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
                title: 'Download',
                onClick: () => {
                    const link = document.createElement('a');
                    link.href = doc.url;
                    link.download = doc.filename;
                    link.click();
                }
            });

            // Add open in new tab button
            this.pswp.ui.registerElement({
                name: 'external',
                order: 9,
                isButton: true,
                html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>',
                title: 'Open in new tab',
                onClick: () => {
                    window.open(doc.url, '_blank');
                }
            });
        });

        // Handle close event
        this.pswp.on('close', () => {
            this.pswp = null;
        });

        // Initialize and open
        this.pswp.init();
    }

    close() {
        if (this.pswp) {
            this.pswp.close();
        }
    }
}

// Usage example - replace the openImageWithNativeViewer method in DocumentsPage:
/*
class DocumentsPage {
    constructor() {
        // ... existing code ...
        this.photoSwipeViewer = new PhotoSwipeImageViewer();
    }

    openImageWithNativeViewer(doc) {
        this.photoSwipeViewer.openImage(doc);
    }
}
*/

// Alternative: Simple integration without class modification
window.openImageWithPhotoSwipe = function(doc) {
    const viewer = new PhotoSwipeImageViewer();
    viewer.openImage(doc);
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PhotoSwipeImageViewer;
} 