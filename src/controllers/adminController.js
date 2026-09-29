const User = require("../models/User");
const Book = require("../models/Book");

const getDashboardStats = async (req, res) => {
  try {
    const [
      totalUsers,
      totalParents,
      totalStudents,
      totalBooks,
      activeBooks,
      inactiveBooks,
      archivedBooks,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "parent" }),
      User.countDocuments({ role: "student" }),
      Book.countDocuments(),
      Book.countDocuments({ status: "active" }),
      Book.countDocuments({ status: "inactive" }),
      Book.countDocuments({ status: "archived" }),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        totalParents,
        totalStudents,
        totalBooks,
        activeBooks,
        inactiveBooks,
        archivedBooks,
      },
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  getDashboardStats,
};
