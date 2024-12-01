const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp"); // Imported sharp library for image compression
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(fileUpload());
app.use('/uploads', express.static('uploads')); // Serve static files

// MongoDB Atlas connection
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://rajasri:rajasri@cluster0.irmyw.mongodb.net/users?retryWrites=true&w=majority&appName=Cluster0";
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
});

const User = mongoose.model("User", userSchema);

// Diagnosis Schema
const diagnosisSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  imagePath: { 
    type: String, 
    required: true 
  },
  diagnosis: [{
    label: String,
    score: Number
  }],
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

const Diagnosis = mongoose.model("Diagnosis", diagnosisSchema);

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, "SECRET_KEY", (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};


// Signup route
app.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: "User created successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Login route
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(403).json({ message: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, "SECRET_KEY", { expiresIn: "1h" });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forgot password route
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Generate a reset token (in production, email it to the user)
    const resetToken = jwt.sign({ id: user._id }, "RESET_KEY", { expiresIn: "15m" });
    res.json({ message: "Reset token generated", resetToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Image upload with multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

app.post("/upload", upload.single("file"), (req, res) => {
  try {
    res.json({ message: "File uploaded successfully", path: req.file.path });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "File upload failed" });
  }
});

// Image upload for Hugging Face API
app.post("/api/upload", authenticateToken, async (req, res) => {
  if (!req.files || !req.files.image) {
    return res.status(400).send({ message: "No image file uploaded" });
  }

  const image = req.files.image;
  const buffer = image.data;

  if (!process.env.HUGGING_FACE_API_KEY) {
    return res.status(500).json({ message: "Missing Hugging Face API key" });
  }

  try {
    // Compress the image before sending to the model
    const compressedBuffer = await sharp(buffer).resize(224, 224).jpeg({ quality: 80 }).toBuffer();

    // Send compressed image to Hugging Face model
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/ozair23/mobilenet_v2_1.0_224-finetuned-plantdisease",
      compressedBuffer,
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGING_FACE_API_KEY}`,
          "Content-Type": "application/octet-stream",
        },
      }
    );

    // Save the uploaded image
    const imageName = `uploads/${Date.now()}-${image.name}`;
    fs.writeFileSync(imageName, compressedBuffer);

    // Save diagnosis to database
    const newDiagnosis = new Diagnosis({
      userId: req.user.id,
      imagePath: imageName,
      diagnosis: response.data
    });
    await newDiagnosis.save();

    res.json({ 
      diagnosis: response.data,
      imagePath: imageName
    });
  } catch (error) {
    console.error("Error processing image:", error.message);
    res.status(500).send({ message: "Error processing image" });
  }
});


// const authenticate = (req, res, next) => {
//   const token = req.headers.authorization?.split(" ")[1]; // Token is expected in the format "Bearer <token>"
  
//   if (!token) {
//     return res.status(401).json({ message: "Access Denied. No token provided." });
//   }

//   try {
//     const decoded = jwt.verify(token, "SECRET_KEY"); // Use the same secret key as in the login route
//     req.userId = decoded.id; // Attach the user ID to the request object
//     next();
//   } catch (err) {
//     res.status(403).json({ message: "Invalid token." });
//   }
// };
app.get("/diagnosis-history", authenticateToken, async (req, res) => {
  try {
    const diagnoses = await Diagnosis.find({ userId: req.user.id })
      .sort({ createdAt: -1 }); // Sort by most recent first
    res.json(diagnoses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/history", authenticateToken, async (req, res) => {
  try {
    const diagnoses = await Diagnosis.find({ userId: req.user.id })
      .sort({ createdAt: -1 }); // Sort by most recent first
    res.render("history", { diagnoses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
