const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const axios = require("axios"); // Added axios import
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(fileUpload());

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
app.post("/api/upload", async (req, res) => {
  if (!req.files || !req.files.image) {
    return res.status(400).send({ message: "No image file uploaded" });
  }

  const image = req.files.image;
  const buffer = image.data;

  if (!process.env.HUGGING_FACE_API_KEY) {
    return res.status(500).json({ message: "Missing Hugging Face API key" });
  }

  try {
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/ozair23/mobilenet_v2_1.0_224-finetuned-plantdisease",
      buffer,
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGING_FACE_API_KEY}`,
          "Content-Type": "application/octet-stream",
        },
      }
    );

    res.json({ diagnosis: response.data });
  } catch (error) {
    console.error("Error processing image:", error.message);
    res.status(500).send({ message: "Error processing image" });
  }
});


// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
