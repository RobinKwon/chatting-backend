import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// Express 앱 및 HTTP 서버 설정
const app = express();

// CORS 설정
app.use(cors({
  origin: '*', // 개발 환경에서는 모든 도메인 허용
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// 정적 파일 제공 설정
const frontendPath = path.join(dirname(dirname(dirname(__dirname))), 'Frontend', 'public');
app.use(express.static(frontendPath));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 뷰 엔진 설정
app.set('view engine', 'html');
app.engine('html', (path, options, callback) => {
  fs.readFile(path, 'utf-8', callback);
});

// AWS 및 OpenAI 설정
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server,
  path: '/ws',  // WebSocket 엔드포인트 경로 설정
  perMessageDeflate: false  // 성능 향상을 위해 압축 비활성화
});

// 임시 파일 저장 디렉토리 생성
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// WebSocket 연결 처리
wss.on('connection', (ws) => {
  console.log('클라이언트가 연결되었습니다');
  
  let audioBuffer = Buffer.from([]);
  let videoBuffer = Buffer.from([]);
  let sessionId = uuidv4();
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'start_session') {
        sessionId = uuidv4();
        console.log(`새 세션 시작: ${sessionId}`);
        ws.send(JSON.stringify({ type: 'session_started', sessionId }));
      } 
      else if (data.type === 'audio_data') {
        const chunk = Buffer.from(data.data, 'base64');
        audioBuffer = Buffer.concat([audioBuffer, chunk]);
        
        // 데이터가 충분하면 처리
        if (data.isComplete || audioBuffer.length > 1024 * 1024) {
          await processAudioData(audioBuffer, sessionId, ws);
          audioBuffer = Buffer.from([]);
        }
      } 
      else if (data.type === 'video_data') {
        const chunk = Buffer.from(data.data, 'base64');
        videoBuffer = Buffer.concat([videoBuffer, chunk]);
        
        if (data.isComplete || videoBuffer.length > 5 * 1024 * 1024) {
          await processVideoData(videoBuffer, sessionId, ws);
          videoBuffer = Buffer.from([]);
        }
      }
      else if (data.type === 'end_session') {
        console.log(`세션 종료: ${sessionId}`);
        ws.send(JSON.stringify({ type: 'session_ended', sessionId }));
        audioBuffer = Buffer.from([]);
        videoBuffer = Buffer.from([]);
      }
    } catch (error) {
      console.error('메시지 처리 오류:', error);
      ws.send(JSON.stringify({ type: 'error', message: '서버 오류가 발생했습니다' }));
    }
  });
  
  ws.on('close', () => {
    console.log('클라이언트 연결이 종료되었습니다');
    // 필요 시 임시 파일 정리 로직 추가
  });
});

// 오디오 데이터 처리 함수
async function processAudioData(buffer, sessionId, ws) {
  const timestamp = Date.now();
  const filename = `${sessionId}_audio_${timestamp}.webm`;
  const tempFilePath = path.join(tempDir, filename);
  
  try {
    fs.writeFileSync(tempFilePath, buffer);
    
    const s3Key = `audio/${filename}`;
    await uploadToS3(tempFilePath, s3Key);
    
    const transcription = await transcribeAudio(tempFilePath);
    const aiResponse = await generateAIResponse(transcription.text);
    
    ws.send(JSON.stringify({
      type: 'audio_processed',
      s3Key,
      transcription: transcription.text,
      aiResponse
    }));
    
    fs.unlinkSync(tempFilePath);
  } catch (error) {
    console.error('오디오 처리 오류:', error);
    ws.send(JSON.stringify({ type: 'error', message: '오디오 처리 중 오류가 발생했습니다' }));
  }
}

// 비디오 데이터 처리 함수
async function processVideoData(buffer, sessionId, ws) {
  const timestamp = Date.now();
  const filename = `${sessionId}_video_${timestamp}.webm`;
  const tempFilePath = path.join(tempDir, filename);
  
  try {
    fs.writeFileSync(tempFilePath, buffer);
    
    const s3Key = `video/${filename}`;
    await uploadToS3(tempFilePath, s3Key);
    
    const frameFilePath = await extractVideoFrame(tempFilePath);
    const videoAnalysis = await analyzeVideoFrame(frameFilePath);
    
    ws.send(JSON.stringify({
      type: 'video_processed',
      s3Key,
      videoAnalysis
    }));
    
    fs.unlinkSync(tempFilePath);
    if (fs.existsSync(frameFilePath)) {
      fs.unlinkSync(frameFilePath);
    }
  } catch (error) {
    console.error('비디오 처리 오류:', error);
    ws.send(JSON.stringify({ type: 'error', message: '비디오 처리 중 오류가 발생했습니다' }));
  }
}

// S3에 파일 업로드 함수
async function uploadToS3(filePath, key) {
  const fileContent = fs.readFileSync(filePath);
  
  const params = {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: key,
    Body: fileContent
  };
  
  await s3Client.send(new PutObjectCommand(params));
  console.log(`S3에 업로드 완료: ${key}`);
  
  return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// OpenAI API를 사용한 오디오 트랜스크립션 함수
async function transcribeAudio(filePath) {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  formData.append('model', 'whisper-1');
  
  const response = await openai.createTranscription(formData);
  return response.data;
}

// 비디오 프레임 추출 함수 (FFmpeg 필요)
async function extractVideoFrame(videoPath) {
  const outputPath = videoPath.replace('.webm', '_frame.jpg');
  
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    exec(`ffmpeg -i ${videoPath} -vframes 1 ${outputPath}`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(outputPath);
    });
  });
}

// [수정됨] OpenAI API를 사용한 비디오 프레임 분석 함수
// 기존의 createImageAnalysis 메서드는 존재하지 않으므로 플레이스홀더를 사용합니다.
async function analyzeVideoFrame(imagePath) {
  const imageBase64 = fs.readFileSync(imagePath, 'base64');
  // 실제 API 호출 대신 임시 메시지 반환
  return `이미지 분석 결과: 이미지가 성공적으로 업로드되었습니다. (이미지 데이터 길이: ${imageBase64.length})`;
}

// OpenAI API를 사용한 AI 응답 생성 함수
async function generateAIResponse(userMessage) {
  const response = await openai.createChatCompletion({
    model: "gpt-4",
    messages: [
      { role: "system", content: "당신은 친절하고 도움이 되는 AI 친구입니다. 자연스럽고 공감적인 대화를 해보세요." },
      { role: "user", content: userMessage }
    ],
    max_tokens: 500
  });
  
  return response.data.choices[0].message.content;
}

// 기본 라우트
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'vchat.html'));
});

app.get('/vchat', (req, res) => {
  res.sendFile(path.join(frontendPath, 'vchat.html'));
});

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다`);
});

export default {
  app,
  server,
  wss
};
