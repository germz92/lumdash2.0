const axios = require('axios');

// Get the token from command line argument or use a default value
const token = process.argv[2] || ''; // You'll need to provide a valid JWT token

async function testApiEndpoint() {
  if (!token) {
    console.error('Please provide a valid JWT token as an argument');
    console.log('Usage: node test-api-endpoint.js YOUR_JWT_TOKEN');
    return;
  }

  const apiBase = process.env.API_BASE || 'http://localhost:3000';
  
  console.log(`Testing gear packages API with token: ${token.substring(0, 10)}...`);
  
  try {
    // Test the primary endpoint
    console.log(`Testing primary endpoint: ${apiBase}/api/gear-packages`);
    const response = await axios.get(`${apiBase}/api/gear-packages`, {
      headers: { 'Authorization': token }
    });
    
    console.log('API Response Status:', response.status);
    console.log('Response Data:', JSON.stringify(response.data, null, 2));
    
    if (response.data && response.data.length > 0) {
      console.log(`SUCCESS: Found ${response.data.length} packages via API endpoint`);
    } else {
      console.log('No packages found via API endpoint, trying fallback...');
      
      // Try the fallback endpoint
      console.log(`Testing fallback endpoint: ${apiBase}/api/gear-packages-fallback`);
      const fallbackResponse = await axios.get(`${apiBase}/api/gear-packages-fallback`, {
        headers: { 'Authorization': token }
      });
      
      console.log('Fallback API Response Status:', fallbackResponse.status);
      console.log('Fallback Response Data:', JSON.stringify(fallbackResponse.data, null, 2));
      
      if (fallbackResponse.data && fallbackResponse.data.length > 0) {
        console.log(`SUCCESS: Found ${fallbackResponse.data.length} packages via fallback endpoint`);
      } else {
        console.log('No packages found via fallback endpoint either');
        console.log('This confirms there is an issue with the API endpoints');
      }
    }
  } catch (error) {
    console.error('Error testing API endpoint:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    
    // Try the fallback endpoint if primary fails
    try {
      console.log('Primary endpoint failed, trying fallback...');
      console.log(`Testing fallback endpoint: ${apiBase}/api/gear-packages-fallback`);
      
      const fallbackResponse = await axios.get(`${apiBase}/api/gear-packages-fallback`, {
        headers: { 'Authorization': token }
      });
      
      console.log('Fallback API Response Status:', fallbackResponse.status);
      console.log('Fallback Response Data:', JSON.stringify(fallbackResponse.data, null, 2));
      
      if (fallbackResponse.data && fallbackResponse.data.length > 0) {
        console.log(`SUCCESS: Found ${fallbackResponse.data.length} packages via fallback endpoint`);
      } else {
        console.log('No packages found via fallback endpoint either');
      }
    } catch (fallbackError) {
      console.error('Error testing fallback endpoint:', fallbackError.message);
      if (fallbackError.response) {
        console.error('Fallback response status:', fallbackError.response.status);
        console.error('Fallback response data:', fallbackError.response.data);
      }
    }
  }
}

testApiEndpoint().catch(err => console.error('Unhandled error:', err)); 