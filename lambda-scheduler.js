
const { EC2Client, DescribeInstancesCommand, RunInstancesCommand } = require("@aws-sdk/client-ec2");

const ec2Client = new EC2Client({ region: process.env.AWS_REGION || "ap-south-1" });

const getUserData = (s3Bucket) => `#!/bin/bash
yum update -y
yum install -y nodejs npm git

yum install -y alsa-lib atk cups-libs gtk3 ipa-gothic-fonts libXcomposite libXcursor libXdamage libXext libXi libXrandr libXScrnSaver libXss libXtst pango xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi xorg-x11-utils xorg-x11-fonts-cyrillic xorg-x11-fonts-Type1 xorg-x11-fonts-misc


aws s3 cp s3://${s3Bucket}/design-hackathon-scraper.zip .
unzip -o design-hackathon-scraper.zip
rm design-hackathon-scraper.zip


npm install

cat > /etc/systemd/system/design-hackathon-scraper.service << EOF
[Unit]
Description=Design Hackathon Scraper
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user
ExecStart=/usr/bin/node /home/ec2-user/server.js
Environment="AUTO_SHUTDOWN=true"
Environment="SHUTDOWN_DELAY=30000"
Environment="NODE_ENV=production"
Restart=no
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

chown -R ec2-user:ec2-user /home/ec2-user

systemctl daemon-reload
systemctl enable design-hackathon-scraper.service
systemctl start design-hackathon-scraper.service
`;

exports.handler = async (event) => {
    console.log('Starting Design Hackathon Scraper...');
    
    try {
        // Define parameters for checking running instances
        const describeParams = {
            Filters: [
                {
                    Name: 'tag:Name',
                    Values: ['design-hackathon-scraper']
                },
                {
                    Name: 'instance-state-name',
                    Values: ['running', 'pending']
                }
            ]
        };
        
       
        const runningInstances = await ec2Client.send(new DescribeInstancesCommand(describeParams));
        
        if (runningInstances.Reservations.length > 0) {
            console.log('Instance already running, skipping...');
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Scraper instance already running' })
            };
        }
        
        const userDataScript = getUserData(process.env.S3_BUCKET);

      
        const runParams = {
            ImageId: 'ami-03f4878755434977f', // Amazon Linux 2 AMI for ap-south-1
            InstanceType: 't2.micro',
            KeyName: process.env.KEY_PAIR_NAME,
            SecurityGroupIds: [process.env.SECURITY_GROUP_ID],
            IamInstanceProfile: {
                Name: process.env.IAM_INSTANCE_PROFILE
            },
            MinCount: 1,
            MaxCount: 1,
            UserData: Buffer.from(userDataScript).toString('base64'),
            TagSpecifications: [
                {
                    ResourceType: 'instance',
                    Tags: [
                        { Key: 'Name', Value: 'design-hackathon-scraper' },
                        { Key: 'Purpose', Value: 'automated-scraping' },
                        { Key: 'AutoShutdown', Value: 'true' }
                    ]
                }
            ]
        };
        
        // Use the new .send() syntax with a command object
        const result = await ec2Client.send(new RunInstancesCommand(runParams));
        
        console.log('Instance launched:', result.Instances[0].InstanceId);
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Scraper instance launched successfully',
                instanceId: result.Instances[0].InstanceId
            })
        };
        
    } catch (error) {
        console.error('Error launching instance:', error);
        
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Failed to launch scraper instance',
                error: error.message
            })
        };
    }
};