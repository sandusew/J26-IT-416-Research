require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI missing');
  process.exit(1);
}
const safe = uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
console.log('MONGODB_URI=', safe);

mongoose
  .connect(uri, { serverSelectionTimeoutMS: 25000 })
  .then(() => {
    console.log('connected_db=', mongoose.connection.name);
    return mongoose.connection.db.admin().command({ ping: 1 });
  })
  .then((r) => {
    console.log('ping_ok=', r.ok);
    return mongoose.disconnect();
  })
  .catch((e) => {
    console.error('FAIL', e.message);
    process.exit(1);
  });
