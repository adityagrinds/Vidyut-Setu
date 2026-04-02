db = db.getSiblingDB("sauryasetu");

db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ houseId: 1 }, { unique: true });
db.listings.createIndex({ status: 1, createdAt: -1 });
db.transactions.createIndex({ createdAt: -1 });
