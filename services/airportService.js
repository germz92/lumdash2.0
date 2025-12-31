const axios = require('axios');

// Major commercial airports database with coordinates
const MAJOR_AIRPORTS = [
  { code: 'ATL', name: 'Hartsfield-Jackson Atlanta International', city: 'Atlanta, GA', lat: 33.6407, lng: -84.4277 },
  { code: 'LAX', name: 'Los Angeles International', city: 'Los Angeles, CA', lat: 33.9425, lng: -118.4081 },
  { code: 'ORD', name: 'O\'Hare International', city: 'Chicago, IL', lat: 41.9742, lng: -87.9073 },
  { code: 'DFW', name: 'Dallas/Fort Worth International', city: 'Dallas, TX', lat: 32.8998, lng: -97.0403 },
  { code: 'DEN', name: 'Denver International', city: 'Denver, CO', lat: 39.8617, lng: -104.6737 },
  { code: 'JFK', name: 'John F. Kennedy International', city: 'New York, NY', lat: 40.6413, lng: -73.7781 },
  { code: 'SFO', name: 'San Francisco International', city: 'San Francisco, CA', lat: 37.6213, lng: -122.3790 },
  { code: 'LAS', name: 'McCarran International', city: 'Las Vegas, NV', lat: 36.0840, lng: -115.1537 },
  { code: 'SEA', name: 'Seattle-Tacoma International', city: 'Seattle, WA', lat: 47.4502, lng: -122.3088 },
  { code: 'CLT', name: 'Charlotte Douglas International', city: 'Charlotte, NC', lat: 35.2144, lng: -80.9473 },
  { code: 'MIA', name: 'Miami International', city: 'Miami, FL', lat: 25.7959, lng: -80.2870 },
  { code: 'PHX', name: 'Phoenix Sky Harbor International', city: 'Phoenix, AZ', lat: 33.4373, lng: -112.0078 },
  { code: 'IAH', name: 'George Bush Intercontinental', city: 'Houston, TX', lat: 29.9902, lng: -95.3368 },
  { code: 'BOS', name: 'Logan International', city: 'Boston, MA', lat: 42.3656, lng: -71.0096 },
  { code: 'MSP', name: 'Minneapolis-St. Paul International', city: 'Minneapolis, MN', lat: 44.8848, lng: -93.2223 },
  { code: 'DTW', name: 'Detroit Metropolitan Wayne County', city: 'Detroit, MI', lat: 42.2162, lng: -83.3554 },
  { code: 'PHL', name: 'Philadelphia International', city: 'Philadelphia, PA', lat: 39.8729, lng: -75.2437 },
  { code: 'LGA', name: 'LaGuardia Airport', city: 'New York, NY', lat: 40.7769, lng: -73.8740 },
  { code: 'BWI', name: 'Baltimore/Washington International', city: 'Baltimore, MD', lat: 39.1774, lng: -76.6684 },
  { code: 'DCA', name: 'Ronald Reagan Washington National', city: 'Washington, DC', lat: 38.8512, lng: -77.0402 },
  { code: 'IAD', name: 'Washington Dulles International', city: 'Washington, DC', lat: 38.9531, lng: -77.4565 },
  { code: 'SLC', name: 'Salt Lake City International', city: 'Salt Lake City, UT', lat: 40.7899, lng: -111.9791 },
  { code: 'HNL', name: 'Daniel K. Inouye International', city: 'Honolulu, HI', lat: 21.3250, lng: -157.9250 },
  { code: 'PDX', name: 'Portland International', city: 'Portland, OR', lat: 45.5898, lng: -122.5951 },
  { code: 'TPA', name: 'Tampa International', city: 'Tampa, FL', lat: 27.9904, lng: -82.5544 },
  { code: 'STL', name: 'Lambert-St. Louis International', city: 'St. Louis, MO', lat: 38.7487, lng: -90.3700 },
  { code: 'BNA', name: 'Nashville International', city: 'Nashville, TN', lat: 36.1245, lng: -86.6782 },
  { code: 'AUS', name: 'Austin-Bergstrom International', city: 'Austin, TX', lat: 30.1975, lng: -97.6664 },
  { code: 'RDU', name: 'Raleigh-Durham International', city: 'Raleigh, NC', lat: 35.8801, lng: -78.7880 },
  { code: 'SAN', name: 'San Diego International', city: 'San Diego, CA', lat: 32.7338, lng: -117.1933 }
];

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lng1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lng2 - Longitude of second point
 * @returns {number} Distance in miles
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Geocode an address to get coordinates
 * @param {string} address - The address to geocode
 * @returns {Promise<{lat: number, lng: number}|null>} Coordinates or null if not found
 */
async function geocodeAddress(address) {
  try {
    if (!address || typeof address !== 'string') {
      return null;
    }

    // Use OpenStreetMap Nominatim API (free, no API key required)
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'LumDash-App/1.0' // Required by Nominatim
      },
      timeout: 5000
    });

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      return {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon)
      };
    }

    return null;
  } catch (error) {
    console.error('Geocoding error:', error.message);
    return null;
  }
}

/**
 * Find the nearest commercial airport to given coordinates
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {object|null} Nearest airport info or null
 */
function findNearestAirport(lat, lng) {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    return null;
  }

  let nearestAirport = null;
  let shortestDistance = Infinity;

  for (const airport of MAJOR_AIRPORTS) {
    const distance = calculateDistance(lat, lng, airport.lat, airport.lng);
    if (distance < shortestDistance) {
      shortestDistance = distance;
      nearestAirport = {
        ...airport,
        distance: Math.round(distance)
      };
    }
  }

  return nearestAirport;
}

/**
 * Find the nearest commercial airport for a given address
 * @param {string} address - The address to find nearest airport for
 * @returns {Promise<object|null>} Airport info with distance or null
 */
async function findNearestAirportByAddress(address) {
  try {
    console.log(`Finding nearest airport for address: ${address}`);
    
    // First, geocode the address
    const coordinates = await geocodeAddress(address);
    if (!coordinates) {
      console.log('Could not geocode address');
      return null;
    }

    console.log(`Geocoded to: ${coordinates.lat}, ${coordinates.lng}`);
    
    // Find nearest airport
    const airport = findNearestAirport(coordinates.lat, coordinates.lng);
    if (airport) {
      console.log(`Nearest airport: ${airport.code} (${airport.distance} miles)`);
      return {
        code: airport.code,
        name: airport.name,
        city: airport.city,
        distance: airport.distance
      };
    }

    return null;
  } catch (error) {
    console.error('Error finding nearest airport:', error.message);
    return null;
  }
}

module.exports = {
  findNearestAirportByAddress,
  findNearestAirport,
  geocodeAddress,
  calculateDistance
};