require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');

const users = [
  {
    username: 'admin1',
    password: 'admin123',
    role: 'admin',
    displayName: 'Admin — BR401 KIA Bhootnath',
    branch: 'branch1',
    branchName: 'BR401 - KIA Bhootnath',
  },
  {
    username: 'staff1',
    password: 'staff123',
    role: 'staff',
    displayName: 'Staff — BR401 KIA Bhootnath',
    branch: 'branch1',
    branchName: 'BR401 - KIA Bhootnath',
  },
  {
    username: 'admin2',
    password: 'admin123',
    role: 'admin',
    displayName: 'Admin — BR201 KIA Kurji',
    branch: 'branch2',
    branchName: 'BR201 - KIA Kurji',
  },
  {
    username: 'staff2',
    password: 'staff123',
    role: 'staff',
    displayName: 'Staff — BR201 KIA Kurji',
    branch: 'branch2',
    branchName: 'BR201 - KIA Kurji',
  },
];

(async () => {
  try {
    await connectDB();
    await User.deleteMany({});
    for (const user of users) {
      await User.create(user);
    }
    console.log('Users seeded successfully');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
})();
