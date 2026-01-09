/**
 * Miami Beach Resort - HK API with Real-Time Webhooks
 * Combined: Housekeeping, Auth, Webhooks, Notifications
 * TIMEZONE: Asia/Dhaka (GMT+6)
 */

const express = require('express');
const cors = require('cors');
const { Firestore } = require('@google-cloud/firestore');
const nodemailer = require('nodemailer');

const app = express();

// Bangladesh Timezone (GMT+6)
const TIMEZONE = 'Asia/Dhaka';
const getNowBD = () => new Date().toLocaleString('en-US', { timeZone: TIMEZONE });
const getTodayBD = () => new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });

// Initialize Firestore
const db = new Firestore({
    projectId: 'beds24-483408',
    databaseId: 'hk-miami'
});

// Collections
const HK_COLLECTION = 'housekeeping_data';
const USERS_COLLECTION = 'hk_users';
const OTP_COLLECTION = 'otp_codes';
const NOTIFICATIONS_COLLECTION = 'booking_notifications';

// Email config
const emailUser = process.env.EMAIL_USER || 'me.shovon@gmail.com';
const emailPass = process.env.EMAIL_PASS || 'cayqfuwnmenowljd';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: emailUser, pass: emailPass }
});

// CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// ============================================================
// Health check
// ============================================================
app.get('/', (req, res) => {
    res.json({
        status: 'HK API with Auth running',
        timezone: TIMEZONE,
        todayBD: getTodayBD(),
        timestampBD: getNowBD(),
        timestampUTC: new Date().toISOString(),
        emailConfigured: true,
        webhookEndpoint: '/webhook/booking'
    });
});

// ============================================================
// WEBHOOK ENDPOINT - Receives Beds24 booking notifications
// ============================================================

app.post('/webhook/booking', async (req, res) => {
    try {
        console.log('=== WEBHOOK RECEIVED ===');
        console.log('Headers:', JSON.stringify(req.headers));
        console.log('Body:', JSON.stringify(req.body));
        
        const webhookData = req.body;
        
        // Create notification document
        const notification = {
            type: 'booking_update',
            bookingId: webhookData.id || webhookData.bookingId || null,
            propertyId: webhookData.propertyId || 279646,
            action: determineAction(webhookData),
            guestName: webhookData.firstName ? 
                `${webhookData.firstName} ${webhookData.lastName || ''}`.trim() : 
                'Unknown Guest',
            roomId: webhookData.roomId || null,
            arrival: webhookData.arrival || null,
            departure: webhookData.departure || null,
            status: webhookData.status || null,
            receivedAt: Firestore.FieldValue.serverTimestamp(),
            processed: false,
            rawData: webhookData
        };

        // Write to Firestore
        const docRef = await db.collection(NOTIFICATIONS_COLLECTION).add(notification);
        console.log(`Notification saved: ${docRef.id}`);

        // Respond to Beds24 immediately
        res.status(200).json({
            success: true,
            notificationId: docRef.id,
            message: 'Webhook received'
        });

        // Auto-cleanup old notifications
        cleanupOldNotifications();

    } catch (error) {
        console.error('Webhook error:', error);
        res.status(200).json({ success: false, error: error.message });
    }
});

function determineAction(data) {
    if (data.cancelTime) return 'cancelled';
    if (data.status === 'request') return 'new_request';
    if (data.bookingTime && data.modifiedTime && data.bookingTime === data.modifiedTime) {
        return 'new_booking';
    }
    return 'modified';
}

async function cleanupOldNotifications() {
    try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
        const oldDocs = await db.collection(NOTIFICATIONS_COLLECTION)
            .where('receivedAt', '<', cutoff)
            .get();
        
        const batch = db.batch();
        oldDocs.docs.forEach(doc => batch.delete(doc.ref));
        
        if (oldDocs.size > 0) {
            await batch.commit();
            console.log(`Cleaned up ${oldDocs.size} old notifications`);
        }
    } catch (error) {
        console.error('Cleanup error:', error);
    }
}

// ============================================================
// NOTIFICATIONS API
// ============================================================

app.get('/notifications', async (req, res) => {
    try {
        const since = req.query.since ? new Date(req.query.since) : null;
        const limit = parseInt(req.query.limit) || 50;

        let query = db.collection(NOTIFICATIONS_COLLECTION)
            .orderBy('receivedAt', 'desc')
            .limit(limit);

        if (since) {
            query = db.collection(NOTIFICATIONS_COLLECTION)
                .where('receivedAt', '>', since)
                .orderBy('receivedAt', 'desc')
                .limit(limit);
        }

        const snapshot = await query.get();
        
        const notifications = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            receivedAt: doc.data().receivedAt?.toDate?.() || null
        }));

        res.json({ success: true, count: notifications.length, notifications });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/notifications/:id', async (req, res) => {
    try {
        await db.collection(NOTIFICATIONS_COLLECTION).doc(req.params.id).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/notifications', async (req, res) => {
    try {
        const snapshot = await db.collection(NOTIFICATIONS_COLLECTION).get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        res.json({ success: true, deleted: snapshot.size });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// HOUSEKEEPING DATA
// ============================================================

app.post('/save', async (req, res) => {
    try {
        const { type, data, timestamp } = req.body;
        if (!type) return res.status(400).json({ error: 'Missing type' });
        
        await db.collection(HK_COLLECTION).doc(type).set({
            data: data,
            timestamp: timestamp || getNowBD(),
            updatedAt: Firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`Saved: ${type}`);
        res.json({ success: true, type });
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/load', async (req, res) => {
    try {
        const { type } = req.query;
        if (!type) return res.status(400).json({ error: 'Missing type' });
        
        const doc = await db.collection(HK_COLLECTION).doc(type).get();
        if (!doc.exists) return res.json({ data: null });
        
        const docData = doc.data();
        res.json({ data: docData.data, timestamp: docData.timestamp });
    } catch (error) {
        console.error('Load error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/list', async (req, res) => {
    try {
        const snapshot = await db.collection(HK_COLLECTION).listDocuments();
        res.json({ types: snapshot.map(doc => doc.id) });
    } catch (error) {
        res.json({ types: [] });
    }
});

app.delete('/delete', async (req, res) => {
    try {
        const { type } = req.query;
        if (!type) return res.status(400).json({ error: 'Missing type' });
        
        await db.collection(HK_COLLECTION).doc(type).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// USER MANAGEMENT
// ============================================================

app.get('/users', async (req, res) => {
    try {
        const snapshot = await db.collection(USERS_COLLECTION).get();
        const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json({ success: true, users });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/users', async (req, res) => {
    try {
        const user = {
            ...req.body,
            createdAt: Firestore.FieldValue.serverTimestamp()
        };
        const docRef = await db.collection(USERS_COLLECTION).add(user);
        res.json({ success: true, id: docRef.id });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/users/:id', async (req, res) => {
    try {
        await db.collection(USERS_COLLECTION).doc(req.params.id).update(req.body);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/users/:id', async (req, res) => {
    try {
        await db.collection(USERS_COLLECTION).doc(req.params.id).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// AUTHENTICATION (OTP)
// ============================================================

app.post('/auth/send-otp', async (req, res) => {
    try {
        const { email } = req.body;
        
        const usersSnapshot = await db.collection(USERS_COLLECTION).where('email', '==', email).get();
        if (usersSnapshot.empty) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const user = { id: usersSnapshot.docs[0].id, ...usersSnapshot.docs[0].data() };
        
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await db.collection(OTP_COLLECTION).doc(email).set({
            otp,
            expiresAt,
            attempts: 0,
            userId: user.id
        });

        await transporter.sendMail({
            from: `"Miami Beach Resort" <${emailUser}>`,
            to: email,
            subject: 'Your Login Code - Miami Beach Resort',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #2D6A6A;">Miami Beach Resort</h2>
                    <p>Your login code is:</p>
                    <div style="font-size: 32px; font-weight: bold; color: #2D6A6A; letter-spacing: 5px; padding: 20px; background: #f0f9f9; border-radius: 8px; text-align: center;">
                        ${otp}
                    </div>
                    <p style="color: #666; margin-top: 20px;">This code expires in 10 minutes.</p>
                </div>
            `
        });

        res.json({ success: true, message: 'OTP sent' });
    } catch (error) {
        console.error('OTP error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/auth/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        
        const otpDoc = await db.collection(OTP_COLLECTION).doc(email).get();
        if (!otpDoc.exists) {
            return res.status(400).json({ success: false, error: 'No OTP found' });
        }

        const otpData = otpDoc.data();
        
        if (new Date() > otpData.expiresAt.toDate()) {
            await db.collection(OTP_COLLECTION).doc(email).delete();
            return res.status(400).json({ success: false, error: 'OTP expired' });
        }

        if (otpData.otp !== otp) {
            const attempts = (otpData.attempts || 0) + 1;
            if (attempts >= 3) {
                await db.collection(OTP_COLLECTION).doc(email).delete();
                return res.status(400).json({ success: false, error: 'Too many attempts' });
            }
            await db.collection(OTP_COLLECTION).doc(email).update({ attempts });
            return res.status(400).json({ success: false, error: 'Invalid OTP' });
        }

        const userDoc = await db.collection(USERS_COLLECTION).doc(otpData.userId).get();
        const user = { id: userDoc.id, ...userDoc.data() };

        await db.collection(OTP_COLLECTION).doc(email).delete();

        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// ROOM CONFIGURATION (Dynamic Total Rooms)
// ============================================================

const CONFIG_COLLECTION = 'room_config';

// Get total room count (dynamically configurable for maintenance)
app.get('/room-config', async (req, res) => {
    try {
        const doc = await db.collection(CONFIG_COLLECTION).doc('total_rooms').get();
        if (!doc.exists) {
            // Default to 45 if not configured
            return res.json({ success: true, totalRooms: 45, source: 'default' });
        }
        const data = doc.data();
        res.json({
            success: true,
            totalRooms: data.count || 45,
            lastUpdated: data.updatedAt?.toDate?.() || null,
            updatedBy: data.updatedBy || null,
            reason: data.reason || null,
            source: 'firestore'
        });
    } catch (error) {
        console.error('Get room config error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update total room count (for admin - when rooms go under maintenance)
app.post('/room-config', async (req, res) => {
    try {
        const { totalRooms, reason, updatedBy } = req.body;

        if (!totalRooms || typeof totalRooms !== 'number' || totalRooms < 1 || totalRooms > 100) {
            return res.status(400).json({
                success: false,
                error: 'totalRooms must be a number between 1 and 100'
            });
        }

        await db.collection(CONFIG_COLLECTION).doc('total_rooms').set({
            count: totalRooms,
            reason: reason || 'Manual update',
            updatedBy: updatedBy || 'system',
            updatedAt: Firestore.FieldValue.serverTimestamp()
        });

        console.log(`Room count updated to ${totalRooms} by ${updatedBy || 'system'}: ${reason || 'Manual update'}`);
        res.json({ success: true, totalRooms });
    } catch (error) {
        console.error('Update room config error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`HK API with webhooks listening on port ${PORT}`));
