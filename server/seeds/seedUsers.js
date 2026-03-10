require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');

const users = [
  {
    username: 'admin1',
    password: 'admin123',
    role: 'admin',
    displayName: 'Admin - Branch 1',
    branch: 'branch1',
    branchName: 'Amarjyoti GS Road',
  },
  {
    username: 'staff1',
    password: 'staff123',
    role: 'staff',
    displayName: 'Staff - Branch 1',
    branch: 'branch1',
    branchName: 'Amarjyoti GS Road',
  },
  {
    username: 'admin2',
    password: 'admin123',
    role: 'admin',
    displayName: 'Admin - Branch 2',
    branch: 'branch2',
    branchName: 'Amarjyoti Zoo Road',
  },
  {
    username: 'staff2',
    password: 'staff123',
    role: 'staff',
    displayName: 'Staff - Branch 2',
    branch: 'branch2',
    branchName: 'Amarjyoti Zoo Road',
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
