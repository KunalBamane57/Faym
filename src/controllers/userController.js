/**
 * User Controller
 * ---------------
 * REST API handlers for user management.
 */

class UserController {
  constructor({ userModel }) {
    this.userModel = userModel;
  }

  /**
   * POST /api/users
   * Create a new user.
   * Body: { name, email }
   */
  createUser = (req, res) => {
    try {
      const { name, email } = req.body;

      if (!name || !email) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: name, email",
        });
      }

      // Check for duplicate email
      const existing = this.userModel.findByEmail(email);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: "A user with this email already exists.",
        });
      }

      const user = this.userModel.create({ name, email });
      return res.status(201).json({ success: true, data: user });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * GET /api/users/:id
   * Get user by ID.
   */
  getUser = (req, res) => {
    try {
      const user = this.userModel.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ success: false, error: "User not found." });
      }
      return res.json({ success: true, data: user });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * GET /api/users
   * List all users.
   */
  listUsers = (req, res) => {
    try {
      const users = this.userModel.findAll();
      return res.json({ success: true, data: users, count: users.length });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };
}

module.exports = UserController;
