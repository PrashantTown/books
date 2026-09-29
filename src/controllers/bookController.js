const Book = require("../models/Book");

const validCategories = [
  "Adventure",
  "Fantasy",
  "Educational",
  "Fiction",
  "Non-fiction",
  "Poetry",
  "Picture Books",
];

const buildBookQuery = (req, user) => {
  const query = {};

  if (req.query.category) {
    query.category = req.query.category;
  }

  if (req.query.ageGroup) {
    query.ageGroup = req.query.ageGroup;
  }

  if (req.query.search) {
    query.$or = [
      { title: { $regex: req.query.search, $options: "i" } },
      { author: { $regex: req.query.search, $options: "i" } },
      { category: { $regex: req.query.search, $options: "i" } },
    ];
  }

  if (user.role !== "admin") {
    query.status = "active";
  }

  if (req.query.status) {
    if (user.role === "admin") {
      query.status = req.query.status;
    } else {
      query.status = "active";
    }
  }

  return query;
};

const validateBookInput = (req, res) => {
  const { title, author, category, ageGroup } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      message: "Title is required",
    });
  }

  if (!author || !author.trim()) {
    return res.status(400).json({
      success: false,
      message: "Author is required",
    });
  }

  if (!category) {
    return res.status(400).json({
      success: false,
      message: "Category is required",
    });
  }

  if (!validCategories.includes(category)) {
    return res.status(400).json({
      success: false,
      message: "Invalid book category",
    });
  }

  if (!ageGroup || !ageGroup.trim()) {
    return res.status(400).json({
      success: false,
      message: "Age group is required",
    });
  }

  return null;
};

const createBook = async (req, res) => {
  try {
    const validationError = validateBookInput(req, res);
    if (validationError) return validationError;

    const {
      title,
      author,
      description,
      category,
      ageGroup,
      coverImage,
      readingUrl,
      pdfUrl,
      publicationInfo,
    } = req.body;

    const book = await Book.create({
      title: title.trim(),
      author: author.trim(),
      description: description || "",
      category,
      ageGroup: ageGroup.trim(),
      coverImage: coverImage || "",
      readingUrl: readingUrl || "",
      pdfUrl: pdfUrl || "",
      publicationInfo: publicationInfo || "",
      status: "active",
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: "Book created successfully",
      book,
    });
  } catch (error) {
    console.error("Create book error:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Invalid book data",
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const getBooks = async (req, res) => {
  try {
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 10;
    const sortOption = req.query.sort || "newest";

    const query = buildBookQuery(req, req.user);

    let sort = { createdAt: -1 };
    if (sortOption === "oldest") {
      sort = { createdAt: 1 };
    } else if (sortOption === "title") {
      sort = { title: 1 };
    }

    const total = await Book.countDocuments(query);
    const books = await Book.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("createdBy", "name email role");

    res.json({
      success: true,
      books,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get books error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const getBook = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: "Invalid book ID",
      });
    }

    const book = await Book.findById(id).populate("createdBy", "name email role");

    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
      });
    }

    if (req.user.role !== "admin" && book.status !== "active") {
      return res.status(404).json({
        success: false,
        message: "Book not found",
      });
    }

    res.json({
      success: true,
      book,
    });
  } catch (error) {
    console.error("Get book error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const updateBook = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: "Invalid book ID",
      });
    }

    const book = await Book.findById(id);

    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
      });
    }

    const allowedFields = [
      "title",
      "author",
      "description",
      "category",
      "ageGroup",
      "coverImage",
      "readingUrl",
      "pdfUrl",
      "publicationInfo",
      "status",
    ];

    const { title, author, category, ageGroup, status } = req.body || {};

    if (title !== undefined && (!title || !title.trim())) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      });
    }

    if (author !== undefined && (!author || !author.trim())) {
      return res.status(400).json({
        success: false,
        message: "Author is required",
      });
    }

    if (category !== undefined && !validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: "Invalid book category",
      });
    }

    if (ageGroup !== undefined && (!ageGroup || !ageGroup.trim())) {
      return res.status(400).json({
        success: false,
        message: "Age group is required",
      });
    }

    if (status !== undefined && !["active", "inactive", "archived"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === "title" || field === "author" || field === "ageGroup") {
          book[field] = req.body[field].trim();
        } else {
          book[field] = req.body[field];
        }
      }
    }

    await book.save();

    res.json({
      success: true,
      message: "Book updated successfully",
      book,
    });
  } catch (error) {
    console.error("Update book error:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Invalid book data",
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const archiveBook = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: "Invalid book ID",
      });
    }

    const book = await Book.findById(id);

    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
      });
    }

    book.status = "archived";
    await book.save();

    res.json({
      success: true,
      message: "Book archived successfully",
    });
  } catch (error) {
    console.error("Archive book error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const activateBook = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: "Invalid book ID",
      });
    }

    const book = await Book.findById(id);

    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
      });
    }

    book.status = "active";
    await book.save();

    res.json({
      success: true,
      message: "Book activated successfully",
      book,
    });
  } catch (error) {
    console.error("Activate book error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const deactivateBook = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: "Invalid book ID",
      });
    }

    const book = await Book.findById(id);

    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
      });
    }

    book.status = "inactive";
    await book.save();

    res.json({
      success: true,
      message: "Book deactivated successfully",
      book,
    });
  } catch (error) {
    console.error("Deactivate book error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  createBook,
  getBooks,
  getBook,
  updateBook,
  archiveBook,
  activateBook,
  deactivateBook,
};
