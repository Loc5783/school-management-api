const mongoose = require('mongoose');

const PurchaseOrderSchema = new mongoose.Schema({
    requestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ProcurementRequest',
        required: true
        // unique: true được khai báo ở index bên dưới
    },
    supplierId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Supplier',
        required: true
    },
    supplierName: {
        type: String,
        required: true
    },
    orderDate: {
        type: Date,
        default: Date.now
    },
    expectedDelivery: {
        type: Date
    },
    items: [{
        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ItemMaster'
        },
        itemName: {
            type: String,
            trim: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        unitPrice: {
            type: Number,
            required: true,
            min: 0
        },
        totalPrice: {
            type: Number,
            required: true,
            min: 0
        },
        note: {
            type: String,
            trim: true
        }
    }],
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    status: {
        type: String,
        enum: ['pending', 'ordered', 'delivered', 'cancelled'],
        default: 'pending'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    note: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

// ==============================
// INDEXES
// ==============================
// Đảm bảo mỗi đề xuất chỉ tạo được 1 đơn hàng
PurchaseOrderSchema.index({ requestId: 1 }, { unique: true });

// Tối ưu truy vấn theo nhà cung cấp và trạng thái
PurchaseOrderSchema.index({ supplierId: 1 });
PurchaseOrderSchema.index({ status: 1 });
PurchaseOrderSchema.index({ orderDate: -1 }); // sắp xếp mới nhất trước

module.exports = mongoose.model('PurchaseOrder', PurchaseOrderSchema);