# Run this command ONCE to enable auto-restart on reboot:
# sudo env PATH=$PATH:/usr/bin /home/panthi/.npm-global/lib/node_modules/pm2/bin/pm2 startup systemd -u panthi --hp /home/panthi
#
# Then save with: pm2 save
#
# For now, auto-startup requires sudo. The PM2 process manager is running
# and will auto-restart the server if it crashes, but a machine reboot
# requires the above sudo command to be run once.