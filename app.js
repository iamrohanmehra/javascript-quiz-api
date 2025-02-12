import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import questions from "./data/questions.js";
import fs from "fs/promises";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    dnsPrefetchControl: true,
    frameguard: { action: "deny" },
    hidePoweredBy: true,
    hsts: true,
    ieNoOpen: true,
    noSniff: true,
    referrerPolicy: { policy: "no-referrer" },
    xssFilter: true,
  })
);

// CORS configuration
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? [process.env.PRODUCTION_DOMAIN]
        : [process.env.CORS_ORIGIN],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400, // 24 hours
  })
);

app.use(express.json());

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: { error: "Too many API requests, please try again later." },
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // limit each IP to 50 submissions per hour
  message: { error: "Too many submissions, please try again later." },
});

// Apply rate limiters
app.use("/api/", apiLimiter);
app.use("/api/submit", submitLimiter);

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
};

// Input validation middleware
const validateSubmission = (req, res, next) => {
  const userAnswers = req.body;

  if (!Array.isArray(userAnswers)) {
    return res
      .status(400)
      .json({ error: "Invalid input. Expected array of answers" });
  }

  const isValidAnswer = (answer) => {
    return (
      typeof answer === "object" &&
      typeof answer.questionId === "number" &&
      typeof answer.selectedOption === "string" &&
      ["A", "B", "C", "D"].includes(answer.selectedOption)
    );
  };

  if (!userAnswers.every(isValidAnswer)) {
    return res.status(400).json({ error: "Invalid answer format" });
  }

  next();
};

// Routes
app.get("/api/debug", (req, res, next) => {
  try {
    res.json({
      questionsLoaded: questions ? true : false,
      questionCount: questions ? questions.length : 0,
      firstQuestion: questions ? questions[0] : null,
    });
  } catch (error) {
    next(error);
  }
});

// Serve static files from views directory
app.use(express.static(join(__dirname, "views")));

// Homepage route
app.get("/", async (req, res, next) => {
  try {
    let html = await fs.readFile(
      join(__dirname, "views", "home.html"),
      "utf-8"
    );
    html = html.replace(
      "${new Date().getFullYear()}",
      new Date().getFullYear()
    );
    res.send(html);
  } catch (error) {
    next(error);
  }
});

app.get("/api/questions", async (req, res, next) => {
  try {
    const questionsWithoutAnswers = questions.map(
      ({ correctAnswer, explanations, ...rest }) => rest
    );
    res.json(questionsWithoutAnswers);
  } catch (error) {
    next(error);
  }
});

app.get("/api/questions/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const question = questions.find((q) => q.id === id);

    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    const { correctAnswer, explanations, ...questionWithoutAnswer } = question;
    res.json(questionWithoutAnswer);
  } catch (error) {
    next(error);
  }
});

app.post("/api/submit", validateSubmission, async (req, res, next) => {
  try {
    const userAnswers = req.body;
    const results = userAnswers.map((answer) => {
      const question = questions.find((q) => q.id === answer.questionId);

      if (!question) {
        return {
          questionId: answer.questionId,
          status: "invalid question",
          correct: false,
        };
      }

      const isCorrect = answer.selectedOption === question.correctAnswer;

      return {
        questionId: answer.questionId,
        correct: isCorrect,
        explanation: question.explanations[answer.selectedOption],
      };
    });

    const score = results.filter((r) => r.correct).length;

    res.json({
      totalQuestions: userAnswers.length,
      correctAnswers: score,
      score: `${((score / userAnswers.length) * 100).toFixed(2)}%`,
      results,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/debug/questions", async (req, res, next) => {
  try {
    res.json({
      total: questions.length,
      questions: questions.map((q) => ({
        id: q.id,
        question: q.question,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// 404 handler for API routes
app.use("/api/*", (req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// 404 handler for all other routes
app.use(async (req, res) => {
  try {
    let html = await fs.readFile(join(__dirname, "views", "404.html"), "utf-8");
    html = html.replace(
      "${new Date().getFullYear()}",
      new Date().getFullYear()
    );
    res.status(404).send(html);
  } catch (error) {
    res.status(404).send("404 - Page Not Found");
  }
});

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

app.listen(PORT, () => {
  console.log(`Server is running in ${NODE_ENV} mode on port ${PORT}`);
  console.log(`Total questions loaded: ${questions.length}`);
});

export default app;
