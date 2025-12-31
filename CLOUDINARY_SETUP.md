# Cloudinary Setup for Document Uploads

## Overview
The document upload feature uses Cloudinary to store and serve PDFs and images. This provides reliable cloud storage with automatic optimization and CDN delivery.

## Required Environment Variables

Add these variables to your `.env` file:

```env
# Cloudinary Configuration (for document uploads)
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

## Getting Cloudinary Credentials

1. Sign up for a free Cloudinary account at https://cloudinary.com/
2. Go to your Dashboard
3. Copy the following values:
   - **Cloud Name**: Found in the "Account Details" section
   - **API Key**: Found in the "Account Details" section  
   - **API Secret**: Found in the "Account Details" section (click "Reveal" to see it)

## Features

- **File Upload**: Drag & drop or click to upload PDFs, JPGs, and PNGs
- **File Size Limit**: 10MB maximum per file
- **Secure Storage**: Files are stored in Cloudinary with organized folder structure
- **Full-Screen Viewer**: View documents in a modal with zoom controls
- **Download**: Download original files
- **Delete**: Remove documents (deletes from both database and Cloudinary)

## File Organization

Files are automatically organized in Cloudinary using this folder structure:
```
lumdash/
  events/
    {eventId}/
      documents/
        {timestamp}_{filename}
```

## Security

- Only event owners can upload and delete documents
- All users with access to the event can view documents
- Files are served through Cloudinary's secure URLs
- Authentication is required for all document operations

## API Endpoints

- `GET /api/tables/:id/documents` - List all documents for an event
- `GET /api/tables/:id/documents/:documentId` - Get specific document details
- `POST /api/tables/:id/documents` - Upload a new document
- `DELETE /api/tables/:id/documents/:documentId` - Delete a document

## Frontend Integration

The documents page is accessible through the "More" dropdown in the navigation. It provides:

- Drag & drop upload interface
- Grid view of all documents with previews
- Full-screen modal viewer with zoom controls
- Download and delete functionality
- Responsive design for mobile and desktop 