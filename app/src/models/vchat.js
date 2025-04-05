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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

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

// 임시 파일 저장 디렉토리 생성
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// WebSocket 서버 설정 및 연결 처리 함수
export function setupWebSocket(server) {
  const wss = new WebSocket.Server({ 
    server,
    path: '/ws',  // WebSocket 엔드포인트 경로 설정
    perMessageDeflate: false
  });

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

  console.log('WebSocket 서버가 /ws 경로에 설정되었습니다.');
  return wss; // 필요시 wss 객체 반환
}

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
  try {
    // 파일 스트림 생성 확인
    const fileStream = fs.createReadStream(filePath);
    if (!fileStream) {
        throw new Error('파일 스트림 생성 실패');
    }

    // Whisper API 호출
    const transcription = await openai.audio.transcriptions.create({
        file: fileStream,
        model: "whisper-1",
    });

    // 결과 반환
    return transcription; // Whisper API는 text 필드를 포함한 객체를 반환합니다
  } catch (error) {
      console.error('오디오 트랜스크립션 오류:', error);
      // 오류 세부 정보 로깅
      if (error.response) {
          console.error('API 응답 데이터:', error.response.data);
          console.error('API 응답 상태:', error.response.status);
          console.error('API 응답 헤더:', error.response.headers);
      } else if (error.request) {
          console.error('API 요청 데이터:', error.request);
      } else {
          console.error('Error 메시지:', error.message);
      }
      throw new Error('오디오 트랜스크립션 중 오류 발생'); // 보다 구체적인 오류 메시지 또는 처리
  }
}

// 비디오 프레임 추출 함수 (FFmpeg 필요)
async function extractVideoFrame(videoPath) {
  const outputPath = videoPath.replace('.webm', '_frame.jpg');
  
  // FFmpeg 경로 설정 (환경에 맞게 수정 필요)
  const ffmpegPath = 'ffmpeg'; // 시스템 PATH에 ffmpeg가 설정되어 있다고 가정

  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    
    // FFmpeg 명령어 보안 강화 (입력 값 이스케이프 등 고려)
    const command = `${ffmpegPath} -i "${videoPath}" -vframes 1 "${outputPath}"`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`FFmpeg 실행 오류: ${error.message}`);
        console.error(`FFmpeg stderr: ${stderr}`);
        reject(new Error(`비디오 프레임 추출 실패: ${error.message}`));
        return;
      }
      if (!fs.existsSync(outputPath)) {
        console.error(`FFmpeg 실행 후 출력 파일 없음: ${outputPath}`);
        console.error(`FFmpeg stdout: ${stdout}`);
        console.error(`FFmpeg stderr: ${stderr}`);
        reject(new Error('비디오 프레임 추출 실패: 출력 파일 생성 안됨'));
        return;
      }
      console.log(`비디오 프레임 추출 성공: ${outputPath}`);
      resolve(outputPath);
    });
  });
}

// [수정됨] OpenAI API를 사용한 비디오 프레임 분석 함수
async function analyzeVideoFrame(imagePath) {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = 'image/jpeg'; // 추출된 프레임이 jpg라고 가정

    const response = await openai.chat.completions.create({
      model: "gpt-4-vision-preview", // 또는 "gpt-4o" 사용 가능
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "이 이미지에 대해 설명해주세요." },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    if (!response.choices || !response.choices[0]?.message?.content) {
      throw new Error('API 응답에서 설명을 찾을 수 없습니다.');
    }
    return response.choices[0].message.content;
  } catch (error) {
    console.error('비디오 프레임 분석 오류:', error);
    return '이미지 분석 중 오류가 발생했습니다.'; // 오류 발생 시 기본 메시지 반환
  }
}

// OpenAI API를 사용한 AI 응답 생성 함수
async function generateAIResponse(userMessage) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 최신 및 추천 모델
      messages: [
        { role: "system", content: "당신은 친절하고 도움이 되는 AI 친구입니다. 자연스럽고 공감적인 대화를 해보세요." },
        { role: "user", content: userMessage }
      ],
      max_tokens: 500, // 응답 최대 길이 설정
      temperature: 0.7 // 창의성 조절 (0.0 ~ 1.0)
    });
    
    if (!response.choices || !response.choices[0]?.message?.content) {
      throw new Error('API 응답에서 내용을 찾을 수 없습니다.');
    }
    return response.choices[0].message.content;
  } catch (error) {
    console.error('AI 응답 생성 오류:', error);
    return 'AI 응답 생성 중 오류가 발생했습니다.'; // 오류 발생 시 기본 메시지 반환
  }
}
