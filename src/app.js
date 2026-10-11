import segmentsData from 'virtual:roxy-segments';
import messagesData from './data/messages.json';
import { createRadioApplication } from './radio-app.js';

export const application = createRadioApplication({ segmentsData, messagesData });
