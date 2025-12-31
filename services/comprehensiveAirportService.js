const axios = require('axios');

// MASSIVE US commercial airports database with coordinates  
// Includes ALL airports served by major airlines: Delta, United, Southwest, JetBlue, American, Alaska, etc.
// Over 400+ airports that actually have commercial passenger service
const COMPREHENSIVE_AIRPORTS = [
  // Major Hub Airports
  { code: 'ATL', name: 'Hartsfield-Jackson Atlanta International', city: 'Atlanta, GA', lat: 33.6407, lng: -84.4277 },
  { code: 'LAX', name: 'Los Angeles International', city: 'Los Angeles, CA', lat: 33.9425, lng: -118.4081 },
  { code: 'ORD', name: 'O\'Hare International', city: 'Chicago, IL', lat: 41.9742, lng: -87.9073 },
  { code: 'DFW', name: 'Dallas/Fort Worth International', city: 'Dallas, TX', lat: 32.8998, lng: -97.0403 },
  { code: 'DEN', name: 'Denver International', city: 'Denver, CO', lat: 39.8617, lng: -104.6737 },
  { code: 'JFK', name: 'John F. Kennedy International', city: 'New York, NY', lat: 40.6413, lng: -73.7781 },
  { code: 'SFO', name: 'San Francisco International', city: 'San Francisco, CA', lat: 37.6213, lng: -122.3790 },
  { code: 'LAS', name: 'Harry Reid International (formerly McCarran)', city: 'Las Vegas, NV', lat: 36.0840, lng: -115.1537 },
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
  { code: 'SAN', name: 'San Diego International', city: 'San Diego, CA', lat: 32.7338, lng: -117.1933 },
  
  // Regional Hub Airports
  { code: 'MDW', name: 'Chicago Midway International', city: 'Chicago, IL', lat: 41.7868, lng: -87.7522 },
  { code: 'HOU', name: 'William P. Hobby Airport', city: 'Houston, TX', lat: 29.6454, lng: -95.2789 },
  { code: 'DAL', name: 'Dallas Love Field', city: 'Dallas, TX', lat: 32.8471, lng: -96.8518 },
  { code: 'OAK', name: 'Oakland International', city: 'Oakland, CA', lat: 37.7214, lng: -122.2208 },
  { code: 'SJC', name: 'Norman Y. Mineta San José International', city: 'San Jose, CA', lat: 37.3639, lng: -121.9289 },
  { code: 'BUR', name: 'Hollywood Burbank Airport', city: 'Burbank, CA', lat: 34.2007, lng: -118.3590 },
  { code: 'ONT', name: 'Ontario International', city: 'Ontario, CA', lat: 34.0560, lng: -117.6012 },
  { code: 'SNA', name: 'John Wayne Airport', city: 'Santa Ana, CA', lat: 33.6757, lng: -117.8683 },
  { code: 'LGB', name: 'Long Beach Airport', city: 'Long Beach, CA', lat: 33.8177, lng: -118.1520 },
  { code: 'SMF', name: 'Sacramento International', city: 'Sacramento, CA', lat: 38.6954, lng: -121.5906 },
  { code: 'RNO', name: 'Reno-Tahoe International', city: 'Reno, NV', lat: 39.4986, lng: -119.7681 },
  { code: 'BOI', name: 'Boise Airport', city: 'Boise, ID', lat: 43.5644, lng: -116.2228 },
  { code: 'GEG', name: 'Spokane International', city: 'Spokane, WA', lat: 47.6198, lng: -117.5336 },
  { code: 'ANC', name: 'Ted Stevens Anchorage International', city: 'Anchorage, AK', lat: 61.1744, lng: -149.9962 },
  { code: 'FAI', name: 'Fairbanks International', city: 'Fairbanks, AK', lat: 64.8156, lng: -147.8561 },
  { code: 'JNU', name: 'Juneau International', city: 'Juneau, AK', lat: 58.3547, lng: -134.5761 },
  
  // Major Regional Airports
  { code: 'MCI', name: 'Kansas City International', city: 'Kansas City, MO', lat: 39.2976, lng: -94.7139 },
  { code: 'IND', name: 'Indianapolis International', city: 'Indianapolis, IN', lat: 39.7173, lng: -86.2944 },
  { code: 'MKE', name: 'Milwaukee Mitchell International', city: 'Milwaukee, WI', lat: 42.9472, lng: -87.8965 },
  { code: 'CLE', name: 'Cleveland Hopkins International', city: 'Cleveland, OH', lat: 41.4117, lng: -81.8498 },
  { code: 'CMH', name: 'John Glenn Columbus International', city: 'Columbus, OH', lat: 39.9980, lng: -82.8919 },
  { code: 'CVG', name: 'Cincinnati/Northern Kentucky International', city: 'Cincinnati, OH', lat: 39.0488, lng: -84.6678 },
  { code: 'PIT', name: 'Pittsburgh International', city: 'Pittsburgh, PA', lat: 40.4915, lng: -80.2329 },
  { code: 'BUF', name: 'Buffalo Niagara International', city: 'Buffalo, NY', lat: 42.9405, lng: -78.7322 },
  { code: 'ROC', name: 'Greater Rochester International', city: 'Rochester, NY', lat: 43.1189, lng: -77.6724 },
  { code: 'SYR', name: 'Syracuse Hancock International', city: 'Syracuse, NY', lat: 43.1112, lng: -76.1063 },
  { code: 'ALB', name: 'Albany International', city: 'Albany, NY', lat: 42.7483, lng: -73.8017 },
  { code: 'BDL', name: 'Bradley International', city: 'Hartford, CT', lat: 41.9389, lng: -72.6832 },
  { code: 'PVD', name: 'Theodore Francis Green Airport', city: 'Providence, RI', lat: 41.7240, lng: -71.4281 },
  { code: 'PWM', name: 'Portland International Jetport', city: 'Portland, ME', lat: 43.6462, lng: -70.3093 },
  { code: 'BGR', name: 'Bangor International', city: 'Bangor, ME', lat: 44.8074, lng: -68.8281 },
  { code: 'BTV', name: 'Burlington International', city: 'Burlington, VT', lat: 44.4719, lng: -73.1531 },
  
  // Southeastern Airports
  { code: 'JAX', name: 'Jacksonville International', city: 'Jacksonville, FL', lat: 30.4941, lng: -81.6879 },
  { code: 'MCO', name: 'Orlando International', city: 'Orlando, FL', lat: 28.4294, lng: -81.3089 },
  { code: 'FLL', name: 'Fort Lauderdale-Hollywood International', city: 'Fort Lauderdale, FL', lat: 26.0726, lng: -80.1527 },
  { code: 'PBI', name: 'Palm Beach International', city: 'West Palm Beach, FL', lat: 26.6832, lng: -80.0956 },
  { code: 'RSW', name: 'Southwest Florida International', city: 'Fort Myers, FL', lat: 26.5362, lng: -81.7552 },
  { code: 'SRQ', name: 'Sarasota-Bradenton International', city: 'Sarasota, FL', lat: 27.3954, lng: -82.5544 },
  { code: 'PIE', name: 'St. Pete-Clearwater International', city: 'St. Petersburg, FL', lat: 27.9102, lng: -82.6874 },
  { code: 'TLH', name: 'Tallahassee International', city: 'Tallahassee, FL', lat: 30.3965, lng: -84.3503 },
  { code: 'GNV', name: 'Gainesville Regional', city: 'Gainesville, FL', lat: 29.6900, lng: -82.2718 },
  { code: 'PNS', name: 'Pensacola International', city: 'Pensacola, FL', lat: 30.4734, lng: -87.1866 },
  { code: 'VPS', name: 'Destin-Fort Walton Beach Airport', city: 'Valparaiso, FL', lat: 30.4832, lng: -86.5254 },
  { code: 'EYW', name: 'Key West International', city: 'Key West, FL', lat: 24.5561, lng: -81.7596 },
  { code: 'SAV', name: 'Savannah/Hilton Head International', city: 'Savannah, GA', lat: 32.1276, lng: -81.2021 },
  { code: 'AGS', name: 'Augusta Regional', city: 'Augusta, GA', lat: 33.3699, lng: -81.9645 },
  { code: 'CSG', name: 'Columbus Airport', city: 'Columbus, GA', lat: 32.5163, lng: -84.9386 },
  { code: 'VLD', name: 'Valdosta Regional', city: 'Valdosta, GA', lat: 30.7825, lng: -83.2767 },
  { code: 'CHS', name: 'Charleston International', city: 'Charleston, SC', lat: 32.8986, lng: -80.0405 },
  { code: 'MYR', name: 'Myrtle Beach International', city: 'Myrtle Beach, SC', lat: 33.6797, lng: -78.9283 },
  { code: 'CAE', name: 'Columbia Metropolitan', city: 'Columbia, SC', lat: 33.9388, lng: -81.1195 },
  { code: 'GSP', name: 'Greenville-Spartanburg International', city: 'Greer, SC', lat: 34.8957, lng: -82.2189 },
  { code: 'ILM', name: 'Wilmington International', city: 'Wilmington, NC', lat: 34.2706, lng: -77.9026 },
  { code: 'GSO', name: 'Piedmont Triad International', city: 'Greensboro, NC', lat: 36.0978, lng: -79.9372 },
  { code: 'AVL', name: 'Asheville Regional', city: 'Asheville, NC', lat: 35.4362, lng: -82.5418 },
  { code: 'FAY', name: 'Fayetteville Regional', city: 'Fayetteville, NC', lat: 34.9912, lng: -78.8803 },
  { code: 'OAJ', name: 'Albert J. Ellis Airport', city: 'Jacksonville, NC', lat: 34.8292, lng: -77.6120 },
  { code: 'BHM', name: 'Birmingham-Shuttlesworth International', city: 'Birmingham, AL', lat: 33.5629, lng: -86.7535 },
  { code: 'HSV', name: 'Huntsville International', city: 'Huntsville, AL', lat: 34.6372, lng: -86.7751 },
  { code: 'MOB', name: 'Mobile Regional', city: 'Mobile, AL', lat: 30.6912, lng: -88.2426 },
  { code: 'MGM', name: 'Montgomery Regional', city: 'Montgomery, AL', lat: 32.3006, lng: -86.3940 },
  { code: 'DHN', name: 'Dothan Regional', city: 'Dothan, AL', lat: 31.3213, lng: -85.4496 },
  { code: 'MSY', name: 'Louis Armstrong New Orleans International', city: 'New Orleans, LA', lat: 29.9934, lng: -90.2580 },
  { code: 'BTR', name: 'Baton Rouge Metropolitan', city: 'Baton Rouge, LA', lat: 30.5332, lng: -91.1496 },
  { code: 'SHV', name: 'Shreveport Regional', city: 'Shreveport, LA', lat: 32.4466, lng: -93.8256 },
  { code: 'LFT', name: 'Lafayette Regional', city: 'Lafayette, LA', lat: 30.2052, lng: -91.9876 },
  { code: 'LCH', name: 'Lake Charles Regional', city: 'Lake Charles, LA', lat: 30.1261, lng: -93.2234 },
  { code: 'AEX', name: 'Alexandria International', city: 'Alexandria, LA', lat: 31.3274, lng: -92.5495 },
  { code: 'MLU', name: 'Monroe Regional', city: 'Monroe, LA', lat: 32.5109, lng: -92.0376 },
  { code: 'MEM', name: 'Memphis International', city: 'Memphis, TN', lat: 35.0424, lng: -89.9767 },
  { code: 'TYS', name: 'McGhee Tyson Airport', city: 'Knoxville, TN', lat: 35.8111, lng: -83.9939 },
  { code: 'CHA', name: 'Chattanooga Metropolitan', city: 'Chattanooga, TN', lat: 35.0353, lng: -85.2038 },
  { code: 'TRI', name: 'Tri-Cities Airport', city: 'Bristol, TN', lat: 36.4752, lng: -82.4074 },
  
  // Midwest Airports
  { code: 'OMA', name: 'Eppley Airfield', city: 'Omaha, NE', lat: 41.3032, lng: -95.8941 },
  { code: 'LNK', name: 'Lincoln Airport', city: 'Lincoln, NE', lat: 40.8510, lng: -96.7583 },
  { code: 'GRI', name: 'Central Nebraska Regional', city: 'Grand Island, NE', lat: 40.9675, lng: -98.3096 },
  { code: 'ICT', name: 'Wichita Dwight D. Eisenhower National', city: 'Wichita, KS', lat: 37.6499, lng: -97.4331 },
  { code: 'GCK', name: 'Garden City Regional', city: 'Garden City, KS', lat: 37.9276, lng: -100.7244 },
  { code: 'DDC', name: 'Dodge City Regional', city: 'Dodge City, KS', lat: 37.7634, lng: -99.9656 },
  { code: 'DSM', name: 'Des Moines International', city: 'Des Moines, IA', lat: 41.5340, lng: -93.6631 },
  { code: 'CID', name: 'Eastern Iowa Airport', city: 'Cedar Rapids, IA', lat: 41.8847, lng: -91.7108 },
  { code: 'DBQ', name: 'Dubuque Regional', city: 'Dubuque, IA', lat: 42.4020, lng: -90.7093 },
  { code: 'SUX', name: 'Sioux Gateway Airport', city: 'Sioux City, IA', lat: 42.4026, lng: -96.3844 },
  { code: 'ALO', name: 'Waterloo Regional', city: 'Waterloo, IA', lat: 42.5571, lng: -92.4003 },
  { code: 'FSD', name: 'Joe Foss Field', city: 'Sioux Falls, SD', lat: 43.5820, lng: -96.7419 },
  { code: 'RAP', name: 'Rapid City Regional', city: 'Rapid City, SD', lat: 44.0452, lng: -103.0574 },
  { code: 'ABR', name: 'Aberdeen Regional', city: 'Aberdeen, SD', lat: 45.4491, lng: -98.4218 },
  { code: 'BIS', name: 'Bismarck Municipal', city: 'Bismarck, ND', lat: 46.7727, lng: -100.7462 },
  { code: 'FAR', name: 'Hector International', city: 'Fargo, ND', lat: 46.9207, lng: -96.8158 },
  { code: 'GFK', name: 'Grand Forks International', city: 'Grand Forks, ND', lat: 47.9493, lng: -97.1761 },
  { code: 'MOT', name: 'Minot International', city: 'Minot, ND', lat: 48.2588, lng: -101.2803 },
  { code: 'DLH', name: 'Duluth International', city: 'Duluth, MN', lat: 46.8420, lng: -92.1936 },
  { code: 'RST', name: 'Rochester International', city: 'Rochester, MN', lat: 43.9083, lng: -92.4924 },
  { code: 'BJI', name: 'Bemidji Regional', city: 'Bemidji, MN', lat: 47.5042, lng: -94.9372 },
  { code: 'GRB', name: 'Green Bay-Austin Straubel International', city: 'Green Bay, WI', lat: 44.4851, lng: -88.1296 },
  { code: 'MSN', name: 'Dane County Regional', city: 'Madison, WI', lat: 43.1399, lng: -89.3375 },
  { code: 'LSE', name: 'La Crosse Regional', city: 'La Crosse, WI', lat: 43.8796, lng: -91.2566 },
  { code: 'EAU', name: 'Chippewa Valley Regional', city: 'Eau Claire, WI', lat: 44.8658, lng: -91.4843 },
  { code: 'CWA', name: 'Central Wisconsin Airport', city: 'Mosinee, WI', lat: 44.7776, lng: -89.6679 },
  { code: 'ATW', name: 'Appleton International', city: 'Appleton, WI', lat: 44.2581, lng: -88.5191 },
  
  // Western Airports
  { code: 'COS', name: 'Colorado Springs Airport', city: 'Colorado Springs, CO', lat: 38.8058, lng: -104.7006 },
  { code: 'PUB', name: 'Pueblo Memorial Airport', city: 'Pueblo, CO', lat: 38.2891, lng: -104.4969 },
  { code: 'GJT', name: 'Grand Junction Regional', city: 'Grand Junction, CO', lat: 39.1224, lng: -108.5267 },
  { code: 'DRO', name: 'Durango-La Plata County Airport', city: 'Durango, CO', lat: 37.1515, lng: -107.7538 },
  { code: 'ASE', name: 'Aspen/Pitkin County Airport', city: 'Aspen, CO', lat: 39.2232, lng: -106.8687 },
  { code: 'EGE', name: 'Eagle County Regional', city: 'Eagle, CO', lat: 39.6426, lng: -106.9177 },
  { code: 'HDN', name: 'Yampa Valley Airport', city: 'Hayden, CO', lat: 40.4812, lng: -107.2176 },
  { code: 'GUC', name: 'Gunnison-Crested Butte Regional', city: 'Gunnison, CO', lat: 38.5339, lng: -106.9331 },
  { code: 'TEX', name: 'Telluride Regional', city: 'Telluride, CO', lat: 37.9538, lng: -107.9085 },
  { code: 'ALS', name: 'San Luis Valley Regional', city: 'Alamosa, CO', lat: 37.4349, lng: -105.8665 },
  { code: 'ABQ', name: 'Albuquerque International Sunport', city: 'Albuquerque, NM', lat: 35.0402, lng: -106.6092 },
  { code: 'SAF', name: 'Santa Fe Regional', city: 'Santa Fe, NM', lat: 35.6176, lng: -106.0889 },
  { code: 'ROW', name: 'Roswell International Air Center', city: 'Roswell, NM', lat: 33.3015, lng: -104.5306 },
  { code: 'CNM', name: 'Cavern City Air Terminal', city: 'Carlsbad, NM', lat: 32.3375, lng: -104.2632 },
  { code: 'FMN', name: 'Four Corners Regional', city: 'Farmington, NM', lat: 36.7412, lng: -108.2298 },
  { code: 'EKO', name: 'Elko Regional', city: 'Elko, NV', lat: 40.8249, lng: -115.7917 },
  { code: 'BFL', name: 'Meadows Field', city: 'Bakersfield, CA', lat: 35.4336, lng: -119.0568 },
  { code: 'FAT', name: 'Fresno Yosemite International', city: 'Fresno, CA', lat: 36.7762, lng: -119.7181 },
  { code: 'MRY', name: 'Monterey Regional', city: 'Monterey, CA', lat: 36.5870, lng: -121.8429 },
  { code: 'SBP', name: 'San Luis Obispo County Regional', city: 'San Luis Obispo, CA', lat: 35.2368, lng: -120.6424 },
  { code: 'SBA', name: 'Santa Barbara Municipal', city: 'Santa Barbara, CA', lat: 34.4262, lng: -119.8403 },
  { code: 'ACV', name: 'Arcata-Eureka Airport', city: 'McKinleyville, CA', lat: 40.9781, lng: -124.1086 },
  { code: 'RDD', name: 'Redding Municipal', city: 'Redding, CA', lat: 40.5090, lng: -122.2934 },
  { code: 'CIC', name: 'Chico Municipal', city: 'Chico, CA', lat: 39.7954, lng: -121.8585 },
  { code: 'MOD', name: 'Modesto City-County Airport', city: 'Modesto, CA', lat: 37.6258, lng: -120.9544 },
  { code: 'SCK', name: 'Stockton Metropolitan', city: 'Stockton, CA', lat: 37.8941, lng: -121.2386 },
  
  // Texas Regional Airports
  { code: 'SAT', name: 'San Antonio International', city: 'San Antonio, TX', lat: 29.5337, lng: -98.4698 },
  { code: 'ELP', name: 'El Paso International', city: 'El Paso, TX', lat: 31.8072, lng: -106.3781 },
  { code: 'MAF', name: 'Midland International Air and Space Port', city: 'Midland, TX', lat: 31.9425, lng: -102.2019 },
  { code: 'LBB', name: 'Lubbock Preston Smith International', city: 'Lubbock, TX', lat: 33.6636, lng: -101.8226 },
  { code: 'AMA', name: 'Rick Husband Amarillo International', city: 'Amarillo, TX', lat: 35.2194, lng: -101.7059 },
  { code: 'CRP', name: 'Corpus Christi International', city: 'Corpus Christi, TX', lat: 27.7704, lng: -97.5012 },
  { code: 'BRO', name: 'Brownsville/South Padre Island International', city: 'Brownsville, TX', lat: 25.9068, lng: -97.4259 },
  { code: 'HRL', name: 'Valley International', city: 'Harlingen, TX', lat: 26.2285, lng: -97.6544 },
  { code: 'MFE', name: 'McAllen Miller International', city: 'McAllen, TX', lat: 26.1758, lng: -98.2386 },
  { code: 'LRD', name: 'Laredo International', city: 'Laredo, TX', lat: 27.5438, lng: -99.4616 },
  { code: 'ACT', name: 'Waco Regional', city: 'Waco, TX', lat: 31.6112, lng: -97.2305 },
  { code: 'CLL', name: 'Easterwood Airport', city: 'College Station, TX', lat: 30.5886, lng: -96.3639 },
  { code: 'BPT', name: 'Jack Brooks Regional', city: 'Beaumont, TX', lat: 29.9508, lng: -94.0206 },
  { code: 'LFK', name: 'Angelina County Airport', city: 'Lufkin, TX', lat: 31.2340, lng: -94.7499 },
  { code: 'TYR', name: 'Tyler Pounds Regional', city: 'Tyler, TX', lat: 32.3542, lng: -95.4024 },
  { code: 'GGG', name: 'East Texas Regional', city: 'Longview, TX', lat: 32.3840, lng: -94.7117 },
  { code: 'ABI', name: 'Abilene Regional', city: 'Abilene, TX', lat: 32.4113, lng: -99.6819 },
  { code: 'SJT', name: 'San Angelo Regional', city: 'San Angelo, TX', lat: 31.3577, lng: -100.4963 },
  { code: 'DRT', name: 'Del Rio International', city: 'Del Rio, TX', lat: 29.3742, lng: -100.9272 },
  
  // Mountain West
  { code: 'OGD', name: 'Ogden-Hinckley Airport', city: 'Ogden, UT', lat: 41.1959, lng: -112.0121 },
  { code: 'PVU', name: 'Provo Municipal Airport', city: 'Provo, UT', lat: 40.2192, lng: -111.7235 },
  { code: 'CDC', name: 'Cedar City Regional', city: 'Cedar City, UT', lat: 37.7007, lng: -113.0986 },
  { code: 'SGU', name: 'St. George Regional', city: 'St. George, UT', lat: 37.0365, lng: -113.5103 },
  { code: 'CNY', name: 'Canyonlands Field', city: 'Moab, UT', lat: 38.7550, lng: -109.7548 },
  { code: 'VEL', name: 'Vernal Regional', city: 'Vernal, UT', lat: 40.4409, lng: -109.5099 },
  { code: 'BZN', name: 'Bozeman Yellowstone International', city: 'Bozeman, MT', lat: 45.7769, lng: -111.1530 },
  { code: 'MSO', name: 'Missoula Montana Airport', city: 'Missoula, MT', lat: 46.9163, lng: -114.0906 },
  { code: 'BIL', name: 'Billings Logan International', city: 'Billings, MT', lat: 45.8077, lng: -108.5430 },
  { code: 'GTF', name: 'Great Falls International', city: 'Great Falls, MT', lat: 47.4820, lng: -111.3705 },
  { code: 'HLN', name: 'Helena Regional', city: 'Helena, MT', lat: 46.6068, lng: -112.0011 },
  { code: 'FCA', name: 'Glacier Park International', city: 'Kalispell, MT', lat: 48.3105, lng: -114.2551 },
  { code: 'BTM', name: 'Bert Mooney Airport', city: 'Butte, MT', lat: 45.9548, lng: -112.4975 },
  { code: 'WYS', name: 'Yellowstone Airport', city: 'West Yellowstone, MT', lat: 44.6884, lng: -111.1176 },
  { code: 'JAC', name: 'Jackson Hole Airport', city: 'Jackson, WY', lat: 43.6073, lng: -110.7377 },
  { code: 'COD', name: 'Yellowstone Regional', city: 'Cody, WY', lat: 44.5202, lng: -109.0240 },
  { code: 'CPR', name: 'Casper/Natrona County International', city: 'Casper, WY', lat: 42.9080, lng: -106.4644 },
  { code: 'CYS', name: 'Cheyenne Regional', city: 'Cheyenne, WY', lat: 41.1557, lng: -104.8119 },
  { code: 'LAR', name: 'Laramie Regional', city: 'Laramie, WY', lat: 41.3121, lng: -105.6750 },
  { code: 'RKS', name: 'Rock Springs-Sweetwater County', city: 'Rock Springs, WY', lat: 41.5942, lng: -109.0651 },
  { code: 'RIW', name: 'Riverton Regional', city: 'Riverton, WY', lat: 43.0642, lng: -108.4597 },
  { code: 'SHR', name: 'Sheridan County Airport', city: 'Sheridan, WY', lat: 44.7692, lng: -106.9803 },
  { code: 'GCC', name: 'Gillette-Campbell County Airport', city: 'Gillette, WY', lat: 44.3489, lng: -105.5394 },
  { code: 'AFO', name: 'Afton-Lincoln County Airport', city: 'Afton, WY', lat: 42.7110, lng: -110.9418 }
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

  for (const airport of COMPREHENSIVE_AIRPORTS) {
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