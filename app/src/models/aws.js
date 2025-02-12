"use strict";

import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import "dotenv/config";

//import express from "express";
//import multer from "multer";
import AWS from "aws-sdk";
import fs from "fs";
import path from "path";

//const app = express();
//const upload = multer({ dest: 'uploads/' });

AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});
const s3 = new AWS.S3();

class S3_Bucket {
    constructor(body) {
        this.body = body;
    }

    // ✅ ChatGPT Vision을 이용한 이미지 설명 요청
    async getImageDescription(imagePath) {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');

            const response = await openai.chat.completions.create({
                model: "gpt-4-turbo",
                messages: [
                    { role: "system", content: "당신은 이미지 설명을 제공하는 AI입니다." },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "이 이미지에 대해 설명해 주세요." },
                            { type: "image_url", image_url: `data:image/jpeg;base64,${base64Image}` }
                        ]
                    }
                ],
                max_tokens: 300
            });

            return response.choices[0].message.content;
        } catch (error) {
            console.error("❌ OpenAI Vision API 호출 실패:", error);
            return "이미지를 분석할 수 없습니다.";
        }
    }    

    async upload_image() {  //app.post('/upload', upload.single('image'), async (req, res) => 
        const client = this.body;

        // ---------------------------------------------
        // 1. Check if a chat session exists for today
        // ---------------------------------------------
        // We want to find a chat session for this user where the session’s created_at date is today.
        // For example, we use MySQL’s DATE() function together with CURDATE().
        let conversation_id;
        let username;
        let fileUrl;
        let description;
        try {
            // Get today’s date in the MySQL date format (YYYY-MM-DD)
            //const today = new Date().toISOString().split('T')[0];
            const today = new Date().toLocaleDateString('ko-KR', { 
                timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
            }).replace(/\. /g, '-').replace('.', ''); // 2025. 02. 09 → 2025-02-09 변환

            const selectUserNameQuery = `SELECT name FROM users WHERE id = ?;`;
            const [usernameResult] = await db.execute(selectUserNameQuery, [client.id]);
            username = usernameResult.length > 0 ? usernameResult[0].name : "무명";

            const selectSessionQuery = `SELECT conversation_id FROM chat_sessions WHERE user_id = ? AND DATE(created_at) = ?;`;
            const [rows] = await db.execute(selectSessionQuery, [client.id, today]);
            if (rows.length > 0) {
                conversation_id = rows[0].conversation_id;
            } else {
                conversation_id = uuidv4();
                const insertSessionQuery = `INSERT INTO chat_sessions (conversation_id, user_id, model_name) VALUES (?, ?, ?);`;
                await db.query(insertSessionQuery, [conversation_id, client.id, 'gpt-4o-mini']);
            }
        } catch (error) {
            console.error("Error fetching or creating chat session:", error);
            return { success: false, error: "Failed to handle chat session." };
        }

        // ---------------------------------------------
        // 2. upload image to S3
        // ---------------------------------------------
        try {
            if (!req.file) {
                return { success: false, error: "No file exist." };
            }
            const fileContent = fs.readFileSync(req.file.path);
            const fileName = Date.now() + path.extname(req.file.originalname);
            // S3 업로드
            const uploadParams = {
                Bucket: process.env.S3_BUCKET_NAME,
                Key: fileName,
                Body: fileContent,
                ACL: 'public-read',
                ContentType: req.file.mimetype
            };
            const s3Response = await s3.upload(uploadParams).promise();
            fileUrl = s3Response.Location;
            
            // OpenAI Vision API 호출
            description = await getImageDescription(req.file.path);
           
            // 로컬 파일 삭제
            fs.unlinkSync(req.file.path);
            //res.json({ message: '업로드 완료', file_url: fileUrl });
        } catch (error) {
            console.error(error);
            return { success: false, error: "Failed to upload." };
        }

        // ---------------------------------------------
        // 4. Save the chat messages to the database
        // ---------------------------------------------
        try {
            // MySQL (RDS)에 업로드 정보 저장
            const [result] = await db.execute(
                `INSERT INTO media_files (user_id, conversation_id, s3_key, file_name, file_type, file_size, description) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    client.id,
                    conversation_id,
                    fileUrl,                // S3 URL
                    req.file.originalname,  // 파일명
                    req.file.mimetype,
                    req.file.size,
                    null                    // 설명 (옵션)
                ]
            );
        }
        catch (error) {
            console.error("Error saving upload image info to DB:", error);
            return { success: false, error: "Failed to save Image info." };
        }

        // ---------------------------------------------
        // 4. Save the chat messages to the database
        // ---------------------------------------------
        try {
            // Save each user message as a 'question'
            if(client.userMessages.length >= 1) {
                let msg = description.replace(/\r?\n/g, ' ');
                const insertUserMsgQuery = `
                    INSERT INTO chat_messages (conversation_id, user_id, q_a, message)
                    VALUES (?, ?, ?, ?);
                `;
                await db.query(insertUserMsgQuery, [conversation_id, client.id, 'file', msg]);
            }
        } catch (error) {
            console.error("Error saving photo explane to DB:", error);
            return { success: false, error: "Failed to save photo explane." };
        }
        return { success: true, message: "upload complete." };
    }
}

export default S3_Bucket;