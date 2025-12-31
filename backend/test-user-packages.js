const axios = require('axios');
const userId = '680eb555c5c1ffece77fef56'; // The user ID from the diagnostic message

async function testUserPackages() {
  console.log(`Testing packages for user ID: ${userId}`);
  
  try {
    // Test the specific user endpoint
    const response = await axios.get(`http://localhost:3333/test/packages/${userId}`);
    console.log('API Response:', JSON.stringify(response.data, null, 2));
    
    if (response.data.packages && response.data.packages.length > 0) {
      console.log(`SUCCESS: Found ${response.data.packages.length} packages for this user ID`);
    } else {
      console.log('No packages found for this user ID in the test endpoint');
    }
  } catch (error) {
    console.error('Error testing user packages:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

testUserPackages().catch(err => console.error('Unhandled error:', err)); 