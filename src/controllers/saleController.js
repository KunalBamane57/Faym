/**
 * Sale Controller
 * ---------------
 * REST API handlers for sales management.
 */

class SaleController {
  constructor({ saleModel, userModel }) {
    this.saleModel = saleModel;
    this.userModel = userModel;
  }

  /**
   * POST /api/sales
   * Create a new sale.
   * Body: { userId, brand, earning }
   */
  createSale = (req, res) => {
    try {
      const { userId, brand, earning } = req.body;

      // Validation
      if (!userId || !brand || earning === undefined) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: userId, brand, earning",
        });
      }
      if (typeof earning !== "number" || earning < 0) {
        return res.status(400).json({
          success: false,
          error: "Earning must be a non-negative number.",
        });
      }

      const validBrands = ["brand_1", "brand_2", "brand_3"];
      if (!validBrands.includes(brand)) {
        return res.status(400).json({
          success: false,
          error: `Invalid brand. Must be one of: ${validBrands.join(", ")}`,
        });
      }

      // Verify user exists
      const user = this.userModel.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, error: "User not found." });
      }

      const sale = this.saleModel.create({ userId, brand, earning });
      return res.status(201).json({ success: true, data: sale });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * GET /api/sales/:id
   * Get a sale by ID.
   */
  getSale = (req, res) => {
    try {
      const sale = this.saleModel.findById(req.params.id);
      if (!sale) {
        return res.status(404).json({ success: false, error: "Sale not found." });
      }
      return res.json({ success: true, data: sale });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * GET /api/sales/user/:userId
   * Get all sales for a user. Optional query: ?status=pending
   */
  getSalesByUser = (req, res) => {
    try {
      const { userId } = req.params;
      const { status } = req.query;
      const sales = this.saleModel.findByUserId(userId, status || null);
      return res.json({ success: true, data: sales, count: sales.length });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };
}

module.exports = SaleController;
