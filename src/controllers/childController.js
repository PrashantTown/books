const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const Child = require("../models/Child");
const User = require("../models/User");

const isValidObjectId = (value) => /^[0-9a-fA-F]{24}$/.test(String(value || ""));

// Looks up a child for the signed-in parent. A missing child is 404 and another
// family's child is 403, the same as the parental-controls endpoints.
// Answers the request itself and returns null when the parent can't use it.
const findOwnChild = async (req, res) => {
  const child = isValidObjectId(req.params.id) ? await Child.findById(req.params.id) : null;
  if (!child) {
    res.status(404).json({ success: false, message: "Child not found" });
    return null;
  }
  if (String(child.parent) !== String(req.user._id)) {
    res.status(403).json({ success: false, message: "You can only manage your own children" });
    return null;
  }
  return child;
};

const getRequestedStudentId = (body = {}) => {
  const value = body.studentId ?? body.student;
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return String(value).trim();
};

const createStudentForParent = async (parentId, childName) => {
  const safeName = (childName || "Student")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .slice(0, 32) || "Student";

  const randomSuffix = crypto.randomBytes(4).toString("hex");
  const email = `child.${safeName.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}.${randomSuffix}@student.local`;
  const tempPassword = `Student${Date.now()}${randomSuffix}!`;
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  const [student] = await User.create([{
    name: `${safeName} Student`,
    email,
    password: hashedPassword,
    role: "student",
    parentId,
    status: "active",
    tokenVersion: 0,
  }]);

  return student;
};

// CREATE CHILD
const createChild = async (req, res) => {
  try {
    const { name, age, band, colour, likes } = req.body;
    const requestedStudentId = getRequestedStudentId(req.body || {});

    if ((req.body && (req.body.studentId !== undefined || req.body.student !== undefined)) && requestedStudentId && !isValidObjectId(requestedStudentId)) {
      return res.status(400).json({
        success: false,
        message: "A valid studentId is required",
      });
    }

    if (!name || age === undefined || !band) {
      return res.status(400).json({
        success: false,
        message: "Name, age and age band are required",
      });
    }

    let student = null;
    let createdStudent = false;

    if (requestedStudentId) {
      student = await User.findOne({
        _id: requestedStudentId,
        role: "student",
        $or: [{ parentId: null }, { parentId: req.user._id }],
      });

      if (!student) {
        return res.status(400).json({
          success: false,
          message: "A valid studentId is required",
        });
      }

      if (!student.parentId) {
        student.parentId = req.user._id;
        await student.save();
      }

      const existingLink = await Child.findOne({ student: student._id });
      if (existingLink) {
        return res.status(409).json({
          success: false,
          message: "Student is already linked to a child",
        });
      }
    } else {
      student = await createStudentForParent(req.user._id, name);
      createdStudent = true;
    }

    let child;
    try {
      child = await Child.create({
        parent: req.user._id,
        student: student ? student._id : null,
        name,
        age,
        band,
        colour: colour || "#0D3B32",
        likes: likes || [],
      });
    } catch (error) {
      if (createdStudent && student && student._id) {
        await User.deleteOne({
          _id: student._id,
          role: "student",
          parentId: req.user._id,
        });
      }
      throw error;
    }

    res.status(201).json({
      success: true,
      message: "Child created successfully",
      child,
    });
  } catch (error) {
    console.error("Create child error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// GET ALL CHILDREN
const getChildren = async (req, res) => {
  try {
    const children = await Child.find({
      parent: req.user._id,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: children.length,
      children,
    });
  } catch (error) {
    console.error("Get children error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// GET ONE CHILD
const getChild = async (req, res) => {
  try {
    const child = await findOwnChild(req, res);
    if (!child) return;

    res.json({
      success: true,
      child,
    });
  } catch (error) {
    console.error("Get child error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// UPDATE CHILD
const updateChild = async (req, res) => {
  try {
    const { name, age, band, colour, likes } = req.body || {};
    const requestedStudentId = getRequestedStudentId(req.body || {});

    if ((req.body && (req.body.studentId !== undefined || req.body.student !== undefined)) && requestedStudentId && !isValidObjectId(requestedStudentId)) {
      return res.status(400).json({
        success: false,
        message: "A valid studentId is required",
      });
    }

    const child = await findOwnChild(req, res);
    if (!child) return;

    if (name !== undefined) {
      child.name = name;
    }

    if (age !== undefined) {
      child.age = age;
    }

    if (band !== undefined) {
      child.band = band;
    }

    if (colour !== undefined) {
      child.colour = colour;
    }

    if (likes !== undefined) {
      child.likes = likes;
    }

    if (requestedStudentId) {
      const previousStudentId = child.student;
      const student = await User.findOne({
        _id: requestedStudentId,
        role: "student",
        $or: [{ parentId: null }, { parentId: req.user._id }],
      });
      if (!student) {
        return res.status(400).json({
          success: false,
          message: "A valid studentId is required",
        });
      }
      if (!student.parentId) {
        student.parentId = req.user._id;
        await student.save();
      }

      const existingLink = await Child.findOne({
        student: student._id,
        _id: { $ne: child._id },
      });
      if (existingLink) {
        return res.status(409).json({
          success: false,
          message: "Student is already linked to a child",
        });
      }
      child.student = student._id;
      if (previousStudentId && previousStudentId.toString() !== student._id.toString()) {
        await User.updateOne(
          { _id: previousStudentId, parentId: req.user._id },
          { $set: { parentId: null } }
        );
      }
    }

    await child.save();

    res.json({
      success: true,
      message: "Child updated successfully",
      child,
    });
  } catch (error) {
    console.error("Update child error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// DELETE CHILD
const deleteChild = async (req, res) => {
  try {
    const child = await findOwnChild(req, res);
    if (!child) return;
    await Child.deleteOne({ _id: child._id });

    if (child.student) {
      await User.updateOne(
        { _id: child.student, parentId: req.user._id },
        { $set: { parentId: null } }
      );
    }

    res.json({
      success: true,
      message: "Child deleted successfully",
    });
  } catch (error) {
    console.error("Delete child error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  createChild,
  getChildren,
  getChild,
  updateChild,
  deleteChild,
};